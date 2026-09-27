import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { resourceArchive } from "@aperture/db";
import { createResourceRoutes } from "../src/routes/resources.js";

test("archive API saves, reads and updates only owned entries; validation/duplicates precede quota", async () => {
  const rows: (typeof resourceArchive.$inferSelect)[] = [];
  const id = "00000000-0000-4000-8000-000000000001";
  let quotaCalls = 0, exhausted = false;
  const app = new Hono();
  app.use("*", async (c, next) => {
    const user = c.req.header("authorization");
    if (!user) return c.json({}, 401);
    c.set("user", { id: user, subject: user, email: "test@example.test", tier: "free", role: "user", orgId: null });
    await next();
  });
  app.route("/resources", createResourceRoutes({
    loadResource: async resourceId => ["resource", "another"].includes(resourceId) ? { id: resourceId, title: "Course", url: "https://example.test", kind: "course", skills: ["SQL"], free: true, level: null, timeCommitment: null, prerequisites: [], summary: null, complexity: null, indexedAt: null, createdAt: new Date() } : null,
    findArchivedResource: async (userId, resourceId) => rows.find(row => row.userId === userId && row.resourceId === resourceId) ?? null,
    persistArchivedResource: async (userId, values) => {
      const row = { ...values, userId, id, progress: "not_started" as const, notes: values.notes ?? null, savedAt: new Date(), updatedAt: new Date() };
      rows.push(row); return row;
    },
    listArchive: async userId => rows.filter(row => row.userId === userId).map(row => ({ ...row, resource: {
      id: row.resourceId, title: "Course", url: "https://example.test", kind: "course", skills: ["SQL"], free: true,
      level: "beginner" as const, timeCommitment: null, prerequisites: [], summary: null, complexity: null, indexedAt: null, createdAt: new Date(),
    } })),
    updateArchive: async (userId, rowId, patch) => {
      const row = rows.find(row => row.id === rowId && row.userId === userId);
      if (!row) return null;
      Object.assign(row, patch); return row;
    },
    consumeQuota: () => createMiddleware(async (c, next) => { quotaCalls++; if (exhausted) return c.json({}, 402); await next(); }),
  }));
  const request = (user: string, method = "GET", path = "", body?: unknown) => app.request("/resources/archive" + path, {
    method, headers: { authorization: user, "content-type": "application/json", "x-user-id": "other" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await app.request("/resources/archive")).status, 401);
  assert.equal((await request("owner", "POST", "", { resourceId: "" })).status, 400);
  assert.equal((await request("owner", "POST", "", { resourceId: "missing" })).status, 404);
  assert.equal(quotaCalls, 0);
  assert.equal((await request("owner", "POST", "", { resourceId: "resource", notes: "Learn SQL", userId: "other" })).status, 201);
  assert.equal((await request("owner", "POST", "", { resourceId: "resource" })).status, 409);
  assert.equal(quotaCalls, 1);
  assert.deepEqual(await (await request("other")).json(), []);
  assert.equal((await request("other", "PATCH", "/" + id, { notes: "stolen" })).status, 404);
  assert.equal((await request("owner", "PATCH", "/bad", { notes: "x" })).status, 400);
  assert.equal((await request("owner", "PATCH", "/" + id, {})).status, 400);
  exhausted = true;
  assert.equal((await request("owner", "POST", "", { resourceId: "another" })).status, 402);
  for (const progress of ["in_progress", "completed", "not_started"]) {
    const response = await request("owner", "PATCH", "/" + id, { progress });
    assert.equal(response.status, 200); assert.equal((await response.json()).notes, "Learn SQL");
  }
  const cleared = await request("owner", "PATCH", "/" + id, { notes: "" });
  assert.equal((await cleared.json()).notes, "");
  assert.equal(quotaCalls, 2, "editing existing saves never spends quota");
  assert.equal((await (await request("owner")).json()).length, 1);
});
