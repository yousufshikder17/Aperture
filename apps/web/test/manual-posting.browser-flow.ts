import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ManualListingCreateSchema, type Listing } from "@aperture/shared";

export function manualPostingFixture() {
  const fixture = { writeStatus: 200, importStatus: 200, writes: 0, methods: [] as string[], rows: [] as Listing[],
    async handle(req: IncomingMessage, res: ServerResponse) {
      const path = new URL(req.url!, "http://localhost").pathname;
      const send = (body: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (path === "/v1/listings/import") {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers["content-type"]! } }).formData();
        const method = String(form.get("method")); fixture.methods.push(method);
        const empty = (form.get("file") as File).name.endsWith(".pdf") && method === "text";
        send({ title: "", company: "", description: empty ? "" : "Imported SQL and TypeScript requirements.", url: "", location: "", salary: "",
          review: { method, warnings: empty ? ["Page 1 has little readable text. Try AI extraction or paste the missing text."] : [] } }, fixture.importStatus);
        return true;
      }
      if (path !== "/v1/listings/manual") return false;
      if (fixture.writeStatus !== 200) { send({}, fixture.writeStatus); return true; }
      let text = ""; for await (const chunk of req) text += String(chunk);
      const body = ManualListingCreateSchema.parse(JSON.parse(text));
      const row: Listing = { ...body, id: body.requestId, source: "manual", postedAt: null };
      if (!fixture.rows.some(old => old.id === row.id)) { fixture.rows.push(row); fixture.writes++; }
      send(row, 201); return true;
    },
  };
  return fixture;
}

export async function checkManualPosting({ browser, evaluate, waitFor, origin, captures, fixture }: {
  browser: (...args: string[]) => Promise<any>; evaluate: (source: string) => Promise<any>;
  waitFor: (source: string) => Promise<unknown>; origin: string; captures: string; fixture: ReturnType<typeof manualPostingFixture>;
}) {
  await browser("open", origin + "/listings");
  await waitFor('document.querySelector(".manual-posting summary") !== null');
  await browser("click", ".manual-posting summary");
  await browser("fill", "[name=postingTitle]", "Manual platform engineer");
  await browser("fill", "[name=postingCompany]", "Example Company");
  await browser("fill", "[name=postingDescription]", "Original draft remains available.");
  fixture.writeStatus = 503;
  await browser("click", ".manual-posting button[type=submit]");
  await waitFor('document.querySelector(".manual-posting [role=alert]")?.textContent.includes("Please retry")');
  assert.equal(await evaluate('document.querySelector("[name=postingDescription]").value'), "Original draft remains available.");
  assert.equal(fixture.writes, 0);
  const path = join(captures, "posting.txt"); writeFileSync(path, "Imported SQL and TypeScript requirements.");
  await browser("upload", "[name=postingFile]", path);
  fixture.importStatus = 422;
  await browser("find", "role", "button", "click", "--name", "Import for review", "--exact");
  await waitFor('document.querySelector(".manual-posting [role=alert]")?.textContent.includes("could not be read")');
  fixture.importStatus = 200;
  await browser("find", "role", "button", "click", "--name", "Import for review", "--exact");
  await waitFor('document.body.textContent.includes("Use imported draft")');
  assert.equal(await evaluate('document.querySelector("[name=postingDescription]").value'), "Original draft remains available.");
  assert.equal(fixture.writes, 0);
  await browser("find", "role", "button", "click", "--name", "Use imported draft", "--exact");
  assert.equal(await evaluate('document.querySelector("[name=postingDescription]").value'), "Imported SQL and TypeScript requirements.");
  assert.equal(await evaluate('document.querySelector("[name=postingTitle]").value'), "Manual platform engineer");
  const pdfPath = join(captures, "posting.pdf"); writeFileSync(pdfPath, "synthetic scanned PDF");
  await browser("upload", "[name=postingFile]", pdfPath);
  assert.equal(await evaluate('document.querySelector("[name=postingMethod]").value'), "text");
  await browser("find", "role", "button", "click", "--name", "Import for review", "--exact");
  await waitFor('document.body.textContent.includes("Page 1 has little readable text")');
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Use imported draft").disabled'), true);
  assert.ok(fixture.methods.every(method => method === "text"), "quality warnings must not trigger AI");
  await browser("select", "[name=postingMethod]", "ai");
  await browser("find", "role", "button", "click", "--name", "Import for review", "--exact");
  await waitFor('document.body.textContent.includes("Extracted with AI")');
  assert.equal(fixture.methods.at(-1), "ai");
  await browser("find", "role", "button", "click", "--name", "Use imported draft", "--exact");
  for (const [width, height, label] of [["1440", "1000", "desktop"], ["390", "844", "mobile"]]) {
    await browser("set", "viewport", width!, height!); await evaluate("window.scrollTo(0,0)");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    await browser("screenshot", join(captures, `manual-posting-${label}.png`), "--full");
  }
  const accessibility = await browser("a11y", "--selector", ".manual-posting");
  assert.equal(accessibility.counts.violations, 0, JSON.stringify(accessibility.violations));
  fixture.writeStatus = 200;
  await browser("click", ".manual-posting button[type=submit]");
  await waitFor('document.querySelector(".manual-posting [role=status]")?.textContent.includes("Posting saved")');
  assert.equal(fixture.writes, 1);
  assert.equal(await evaluate('document.querySelector("[name=postingDescription]").value'), "");
  await browser("reload");
  await waitFor('Array.from(document.querySelectorAll("article h2")).some(el => el.textContent.includes("Manual platform engineer"))');
  assert.equal(fixture.writes, 1);
  console.log("PASS: manual posting save recovery, import review, reload persistence, desktop/mobile and accessibility.");
}
