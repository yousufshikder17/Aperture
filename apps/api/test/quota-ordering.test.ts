import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { createListingRoutes } from "../src/routes/listings.js";
import { createResourceRoutes } from "../src/routes/resources.js";
import type { QuotaKind } from "../src/middleware/tier.js";

const user = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "free@example.test",
  subject: "test:free",
  role: "user" as const,
  tier: "free" as const,
  orgId: null,
};

const profile = {
  userId: user.id,
  masterResume: {},
  referenceList: null,
  version: 1,
  updatedAt: new Date(0),
};

const listing = {
  id: "00000000-0000-0000-0000-000000000002",
  source: "test",
  url: "https://example.test/job",
  title: "Engineer",
  company: "Example",
  location: null,
  salary: null,
  description: "Build things",
  postedAt: null,
  raw: null,
  createdAt: new Date(0),
};

function quotaHarness(initialUsed = 0, cap = 3) {
  let used = initialUsed;
  let reservations = 0;
  const consumeQuota = (kind: QuotaKind) =>
    createMiddleware(async (c, next) => {
      assert.equal(c.get("user").id, user.id);
      if (used >= cap) {
        return c.json(
          { error: "quota_exceeded", kind, cap, used, tier: "free" },
          402,
        );
      }
      used++;
      reservations++;
      await next();
    });
  return {
    consumeQuota,
    get used() {
      return used;
    },
    get reservations() {
      return reservations;
    },
  };
}

function testApp(path: string, routes: Hono) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route(path, routes);
  return app;
}

test("missing profile does not consume match quota", async () => {
  const quota = quotaHarness();
  let scorerCalls = 0;
  const app = testApp(
    "/listings",
    createListingRoutes({
      loadProfile: async () => null,
      loadListing: async () => listing,
      scoreListing: async () => {
        scorerCalls++;
        return {} as never;
      },
      consumeQuota: quota.consumeQuota,
    }),
  );

  const response = await app.request(`/listings/${listing.id}/match`, {
    method: "POST",
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "no_master_resume" });
  assert.equal(quota.used, 0);
  assert.equal(scorerCalls, 0);
});

test("missing listing does not consume match quota", async () => {
  const quota = quotaHarness();
  let scorerCalls = 0;
  const app = testApp(
    "/listings",
    createListingRoutes({
      loadProfile: async () => profile as never,
      loadListing: async () => null,
      scoreListing: async () => {
        scorerCalls++;
        return {} as never;
      },
      consumeQuota: quota.consumeQuota,
    }),
  );

  const response = await app.request("/listings/missing/match", {
    method: "POST",
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "listing_not_found" });
  assert.equal(quota.used, 0);
  assert.equal(scorerCalls, 0);
});

test("valid match consumes quota exactly once and persists exactly once", async () => {
  const quota = quotaHarness();
  let scorerCalls = 0;
  let persistenceCalls = 0;
  const app = testApp(
    "/listings",
    createListingRoutes({
      loadProfile: async () => profile as never,
      loadListing: async () => listing,
      scoreListing: async () => {
        scorerCalls++;
        return {} as never;
      },
      persistMatch: async () => {
        persistenceCalls++;
        return { id: "match-1" } as never;
      },
      consumeQuota: quota.consumeQuota,
    }),
  );

  const response = await app.request(`/listings/${listing.id}/match`, {
    method: "POST",
  });
  assert.equal(response.status, 200);
  assert.equal(quota.used, 1);
  assert.equal(quota.reservations, 1);
  assert.equal(scorerCalls, 1);
  assert.equal(persistenceCalls, 1);
});

test("exhausted match quota blocks scoring and persistence", async () => {
  const quota = quotaHarness(3);
  let scorerCalls = 0;
  let persistenceCalls = 0;
  const app = testApp(
    "/listings",
    createListingRoutes({
      loadProfile: async () => profile as never,
      loadListing: async () => listing,
      scoreListing: async () => {
        scorerCalls++;
        return {} as never;
      },
      persistMatch: async () => {
        persistenceCalls++;
        return {} as never;
      },
      consumeQuota: quota.consumeQuota,
    }),
  );

  const response = await app.request(`/listings/${listing.id}/match`, {
    method: "POST",
  });
  assert.equal(response.status, 402);
  assert.equal(quota.used, 3);
  assert.equal(scorerCalls, 0);
  assert.equal(persistenceCalls, 0);
});

function resourceApp(
  quota: ReturnType<typeof quotaHarness>,
  options: { duplicate?: boolean; onPersist?: () => void } = {},
) {
  return testApp(
    "/resources",
    createResourceRoutes({
      loadResource: async () => ({ id: "resource-1" }) as never,
      findArchivedResource: async () =>
        options.duplicate ? ({ id: "archive-1" } as never) : null,
      persistArchivedResource: async () => {
        options.onPersist?.();
        return { id: "archive-1", resourceId: "resource-1" } as never;
      },
      consumeQuota: quota.consumeQuota,
    }),
  );
}

test("invalid save request does not consume quota", async () => {
  const quota = quotaHarness();
  const app = resourceApp(quota);
  const response = await app.request("/resources/archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notes: "missing resource id" }),
  });
  assert.equal(response.status, 400);
  assert.equal(quota.used, 0);
});

test("duplicate save does not consume quota or insert again", async () => {
  const quota = quotaHarness();
  let persistenceCalls = 0;
  const app = resourceApp(quota, {
    duplicate: true,
    onPersist: () => persistenceCalls++,
  });
  const response = await app.request("/resources/archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resourceId: "resource-1" }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "already_saved" });
  assert.equal(quota.used, 0);
  assert.equal(persistenceCalls, 0);
});

test("valid save consumes quota exactly once and inserts exactly once", async () => {
  const quota = quotaHarness();
  let persistenceCalls = 0;
  const app = resourceApp(quota, {
    onPersist: () => persistenceCalls++,
  });
  const response = await app.request("/resources/archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resourceId: "resource-1" }),
  });
  assert.equal(response.status, 201);
  assert.equal(quota.used, 1);
  assert.equal(quota.reservations, 1);
  assert.equal(persistenceCalls, 1);
});

test("exhausted save quota prevents archive insertion", async () => {
  const quota = quotaHarness(3);
  let persistenceCalls = 0;
  const app = resourceApp(quota, {
    onPersist: () => persistenceCalls++,
  });
  const response = await app.request("/resources/archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resourceId: "resource-1" }),
  });
  assert.equal(response.status, 402);
  assert.equal(quota.used, 3);
  assert.equal(persistenceCalls, 0);
});
