import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { Hono } from "hono";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { extractPosting } from "@aperture/ai";
import * as schema from "@aperture/db";
import { ManualListingCreateSchema } from "@aperture/shared";
import { createManualListingRoutes } from "../src/routes/manual-listings.js";
import { createListingRoutes } from "../src/routes/listings.js";
import { createManualListing, loadAccessibleListing, loadListingRows } from "../src/services/listing-storage.js";
import { applicationStore } from "../src/services/applications.js";

const draft = { requestId: randomUUID(), title: "Engineer", company: "Example", description: "Build TypeScript services.",
  url: "https://example.test/job", location: "Toronto", salary: "" };
function authenticated() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const id = c.req.header("authorization");
    if (!id) return c.json({}, 401);
    c.set("user", { id, subject: id, email: "test@example.test", tier: "pro", role: "user", orgId: null });
    await next();
  });
  return app;
}

test("manual posting validation and upload review; invalid files never spend PDF quota", async () => {
  for (const patch of [{ title: " " }, { description: " " }, { description: "x".repeat(50001) },
    { url: "javascript:alert(1)" }, { url: "https://user:password@example.test" }, { ownerId: "other" }])
    assert.equal(ManualListingCreateSchema.safeParse({ ...draft, ...patch }).success, false);
  const app = authenticated();
  let saves = 0, quota = 0;
  app.route("/", createManualListingRoutes({
    save: async (_owner, input) => { saves++; return { ...input, id: "saved", source: "manual", postedAt: null }; },
    quota: () => async (_c, next) => { quota++; await next(); },
  }));
  assert.equal((await app.request("/manual", { method: "POST" })).status, 401);
  const upload = (name: string, content: BlobPart) => {
    const body = new FormData(); body.set("file", new File([content], name));
    return app.request("/import", { method: "POST", headers: { authorization: "owner" }, body });
  };
  const text = await upload("posting.txt", draft.description);
  assert.equal(text.status, 200);
  assert.equal((await text.json()).description, draft.description);
  const docx = new JSZip();
  docx.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Build services.</w:t></w:r></w:p></w:body></w:document>');
  assert.equal((await extractPosting(await docx.generateAsync({ type: "nodebuffer" }), "docx")).description, "Build services.");
  assert.equal(saves, 0, "import is an unsaved draft");
  assert.equal((await upload("posting.exe", "bad")).status, 415);
  assert.equal((await upload("posting.pdf", "bad")).status, 400);
  assert.equal((await upload("posting.txt", new Uint8Array(4 * 1024 * 1024 + 1))).status, 413);
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 6; i++) pdf.addPage();
  assert.equal((await upload("posting.pdf", await pdf.save())).status, 400);
  assert.equal(quota, 0);
  let extracted = false;
  const pdfApp = authenticated();
  pdfApp.route("/", createManualListingRoutes({
    extract: async () => { assert.equal(quota, 1); extracted = true; return draft; },
    quota: () => async (_c, next) => { quota++; await next(); },
  }));
  const validPdf = await PDFDocument.create(); validPdf.addPage();
  const pdfBody = new FormData(); pdfBody.set("file", new File([await validPdf.save()], "posting.pdf"));
  assert.equal((await pdfApp.request("/import", { method: "POST", headers: { authorization: "owner" }, body: pdfBody })).status, 200);
  assert.equal(extracted, true);
  const response = await app.request("/manual", { method: "POST", headers: { authorization: "owner", "content-type": "application/json" }, body: JSON.stringify(draft) });
  assert.equal(response.status, 201); assert.equal(saves, 1);
});

test("private posting persistence, retry deduplication, same-URL isolation and downstream authorization", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  const namespace = "manual_test_" + randomUUID().replaceAll("-", "");
  await admin.unsafe(`CREATE SCHEMA "${namespace}"`);
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 3, connection: { search_path: namespace } });
  const database = drizzle(sql, { schema });
  try {
    await sql.unsafe(`CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE listings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL,
        url text NOT NULL UNIQUE, title text NOT NULL, company text NOT NULL, location text, salary text,
        description text NOT NULL, posted_at timestamp, raw jsonb, created_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users,
        listing_id uuid REFERENCES listings, profile_version integer, score jsonb, created_at timestamp DEFAULT now());`);
    const owner = randomUUID(), other = randomUUID();
    await sql`INSERT INTO users VALUES (${owner}), (${other})`;
    const [first, retry] = await Promise.all([1, 2].map(() => createManualListing(owner, draft, database)));
    assert(first && retry); assert.equal(first.id, retry.id);
    assert.equal(first.url, draft.url);
    assert.equal((await loadListingRows(owner, undefined, database)).length, 1);
    assert.equal(await createManualListing(owner, { ...draft, title: "Changed" }, database), null);
    const theirs = await createManualListing(other, draft, database);
    assert(theirs); assert.notEqual(theirs.id, first.id);
    assert.equal(await loadAccessibleListing(first.id, other, database), null);
    assert.equal(await applicationStore(database).create(other, { listingId: first.id, status: "saved" }), null);
    const app = authenticated();
    app.route("/listings", createListingRoutes({
      loadRows: (user, id) => loadListingRows(user, id, database),
      loadListing: (id, user) => loadAccessibleListing(id, user, database),
      loadProfile: async () => ({ masterResume: {} } as any),
    }));
    assert.equal((await app.request(`/listings/${first.id}`, { headers: { authorization: owner } })).status, 200);
    for (const [suffix, method] of [["", "GET"], ["/match", "POST"], ["/ats", "POST"], ["/intel", "GET"],
      ["/tailor", "POST"], ["/tailor", "GET"], ["/tailor/pdf", "GET"]]) {
      const response = await app.request(`/listings/${first.id}${suffix}`, { method, headers: { authorization: other } });
      assert.equal(response.status, 404, `${method} ${suffix} leaked private posting`);
    }
    assert.equal((await loadListingRows(other, undefined, database)).length, 1);
    assert.equal((await loadListingRows(other, first.id, database)).length, 0);
    assert.equal((await sql`SELECT * FROM listings`).length, 2);
  } finally {
    await sql.end({ timeout: 1 });
    await admin.unsafe(`DROP SCHEMA "${namespace}" CASCADE`);
    await admin.end();
  }
});
