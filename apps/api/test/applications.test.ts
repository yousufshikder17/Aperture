import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { ApplicationSchema } from "@aperture/shared";
import { createApplicationRoutes } from "../src/routes/applications.js";
import { applicationChanges } from "../src/lib/application-changes.js";
import type { applicationStore } from "../src/services/applications.js";

test("tracker API creates, reloads, edits notes/status and enforces validation, ownership and free-account access", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const listingId = "00000000-0000-4000-8000-000000000002";
  const rows: Awaited<ReturnType<ReturnType<typeof applicationStore>["list"]>> = [];
  let calls = 0;
  const app = new Hono();
  app.use("*", async (c, next) => {
    const user = c.req.header("authorization");
    if (!user) return c.json({}, 401);
    c.set("user", { id: user, subject: user, email: "test@example.test", tier: user === "owner" ? "free" : "pro", role: "user", orgId: null });
    await next();
  });
  app.route("/applications", createApplicationRoutes({
    list: async userId => { calls++; return rows.filter(row => row.userId === userId); },
    create: async (userId, body) => {
      calls++;
      if (body.listingId !== listingId) return null;
      const row = { id, userId, ...body, notes: body.notes ?? null, createdAt: new Date(),
        ...applicationChanges({ status: "", appliedAt: null, events: [] }, body),
        listing: { title: "Engineer", company: "Example" } };
      rows.push(row); return row;
    },
    update: async (userId, rowId, body) => {
      calls++;
      const row = rows.find(row => row.id === rowId && row.userId === userId);
      if (!row) return null;
      Object.assign(row, applicationChanges(row, body)); return row;
    },
  }));
  const request = (user: string, method = "GET", path = "", body?: unknown) => app.request("/applications" + path, {
    method, headers: { authorization: user, "content-type": "application/json", "x-user-id": "attacker" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await app.request("/applications")).status, 401);
  assert.equal(calls, 0);
  assert.equal((await request("owner", "POST", "", { listingId: "bad" })).status, 400);
  assert.equal((await request("owner", "POST", "", { listingId: id })).status, 404);
  const created = await request("owner", "POST", "", { listingId, status: "applied", notes: "Follow up", userId: "other" });
  assert.equal(created.status, 201);
  const original = ApplicationSchema.parse(await created.json());
  assert(original.appliedAt);
  assert.equal((await request("other", "PATCH", "/" + id, { notes: "stolen" })).status, 404);
  assert.deepEqual(await (await request("other")).json(), []);
  assert.equal((await request("owner", "PATCH", "/bad", { status: "offer" })).status, 400);
  assert.equal((await request("owner", "PATCH", "/" + id, {})).status, 400);
  const notes = ApplicationSchema.parse(await (await request("owner", "PATCH", "/" + id, { notes: "" })).json());
  assert.equal(notes.events.length, 1); assert.equal(notes.notes, "");
  const changed = ApplicationSchema.parse(await (await request("owner", "PATCH", "/" + id, { status: "interviewing" })).json());
  assert.equal(changed.events.length, 2); assert.equal(changed.appliedAt, original.appliedAt);
  assert.equal(ApplicationSchema.array().parse(await (await request("owner")).json())[0]?.status, "interviewing");
});
