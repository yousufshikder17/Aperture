import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createListingRoutes } from "../src/routes/listings.js";
import type { AuthenticatedUser } from "../src/middleware/auth.js";
import { ListingRowSchema, FeedScanSchema } from "@aperture/shared";

const id = "00000000-0000-4000-8000-000000000002";
const listing = { id, source: "manual" as const, url: "https://example.test/job", title: "Engineer",
  company: "Example", location: null, salary: null, description: "Build APIs", postedAt: null };

function fixture() {
  let scanCalls = 0;
  const reads: [string, string | undefined][] = [];
  const app = new Hono();
  app.use("*", async (c, next) => {
    const token = c.req.header("authorization");
    if (!["owner", "other", "admin"].includes(token ?? "")) return c.json({}, 401);
    const user: AuthenticatedUser = { id: token!, subject: token!, email: token + "@example.test",
      role: token === "admin" ? "admin" : "user", tier: "free", orgId: null };
    c.set("user", user); await next();
  });
  app.route("/listings", createListingRoutes({
    loadRows: async (owner, key) => {
      reads.push([owner, key]);
      return key && key !== id ? [] : [{ listing, match: null, profileVersion: null }];
    },
    scanFeeds: async () => { scanCalls++; return { configured: 0, succeeded: 0, scanned: 0, inserted: 0, failedSources: [] }; },
  }));
  return { app, reads, scans: () => scanCalls,
    request: (path: string, token = "owner", method = "GET") => app.request("/listings" + path,
      { method, headers: { authorization: token, "x-role": "admin", "x-user-id": "other" } }) };
}

test("public catalog and detail reads use verified identity and validate direct IDs", async () => {
  const f = fixture();
  assert.equal((await f.app.request("/listings/" + id)).status, 401);
  const result = await f.request("/" + id);
  assert.equal(result.status, 200);
  assert.equal(ListingRowSchema.parse(await result.json()).listing.id, id);
  assert.deepEqual(f.reads, [["owner", id]]);
  await f.request("", "other");
  assert.deepEqual(f.reads[1], ["other", undefined]);
  assert.equal((await f.request("/invalid-id")).status, 404);
  assert.equal(f.reads.length, 2);
  assert.equal((await f.request("/00000000-0000-4000-8000-000000000099")).status, 404);
});

test("feed scanning remains administrator-only before any provider or storage work", async () => {
  const f = fixture();
  assert.equal((await f.app.request("/listings/scan", { method: "POST" })).status, 401);
  assert.equal((await f.request("/scan", "owner", "POST")).status, 403);
  assert.equal(f.scans(), 0);
  const result = await f.request("/scan", "admin", "POST");
  assert.equal(result.status, 200);
  assert.equal(FeedScanSchema.parse(await result.json()).configured, 0);
  assert.equal(f.scans(), 1);
});

test("public port does not mount hosted intelligence, tailoring, or tailored PDF routes", async () => {
  const f = fixture();
  for (const token of ["owner", "admin"])
    for (const [path, method] of [["/intel", "GET"], ["/intel", "POST"], ["/tailor", "GET"], ["/tailor", "POST"], ["/tailor/pdf", "GET"]])
      assert.equal((await f.request("/" + id + path, token, method)).status, 404);
  assert.equal(f.reads.length, 0);
  assert.equal(f.scans(), 0);
});
