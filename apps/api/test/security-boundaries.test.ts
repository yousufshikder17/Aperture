import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { DEVELOPMENT_IDENTITIES } from "../src/auth/development-identities.js";
import {
  createAuthMiddleware,
  type AuthenticatedUser,
} from "../src/middleware/auth.js";
import { createBuilderRoutes } from "../src/routes/builder.js";
import { createResourceRoutes } from "../src/routes/resources.js";
import { listingRoutes } from "../src/routes/listings.js";

const principals: Record<
  "free-token" | "premium-token" | "admin-token",
  AuthenticatedUser
> = {
  "free-token": { ...DEVELOPMENT_IDENTITIES.free_user, orgId: null },
  "premium-token": { ...DEVELOPMENT_IDENTITIES.premium_user, orgId: null },
  "admin-token": { ...DEVELOPMENT_IDENTITIES.admin_user, orgId: null },
};

function fixtureAuth() {
  return createAuthMiddleware({
    verifyCredential: async (authorization) => {
      const token = /^Bearer ([^\s]+)$/i.exec(authorization ?? "")?.[1] as
        | keyof typeof principals
        | undefined;
      const principal = token ? principals[token] : undefined;
      return principal
        ? { subject: principal.subject, email: principal.email }
        : null;
    },
    resolvePrincipal: async (identity) => {
      const principal = Object.values(principals).find(
        (candidate) => candidate.subject === identity.subject,
      );
      if (!principal) throw new Error("unknown fixture identity");
      return principal;
    },
  });
}

function authenticatedApp() {
  const app = new Hono();
  app.use("*", fixtureAuth());
  app.get("/me", (c) => c.json(c.get("user")));
  app.get("/owned/:ownerId", (c) => {
    if (c.req.param("ownerId") !== c.get("user").id) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ ownerId: c.get("user").id });
  });
  return app;
}

test("security matrix: authentication, spoofing, and ownership", async () => {
  const app = authenticatedApp();

  assert.equal((await app.request("/me")).status, 401);
  assert.equal(
    (
      await app.request("/me", {
        headers: { "x-user-email": principals["premium-token"].email },
      })
    ).status,
    401,
  );

  const spoofed = await app.request("/me", {
    headers: {
      authorization: "Bearer free-token",
      "x-user-email": principals["premium-token"].email,
      "x-tier": "pro",
      "x-role": "admin",
    },
  });
  assert.equal(spoofed.status, 200);
  assert.equal((await spoofed.json()).id, principals["free-token"].id);

  for (const token of ["free-token", "premium-token"] as const) {
    const otherOwner =
      token === "free-token"
        ? principals["premium-token"].id
        : principals["free-token"].id;
    const response = await app.request(`/owned/${otherOwner}`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-user-id": otherOwner,
      },
    });
    assert.equal(response.status, 404);
  }
});

test("resource synchronization is anonymous-denied and admin-only", async () => {
  let syncCalls = 0;
  const app = new Hono();
  app.use("*", fixtureAuth());
  app.route(
    "/resources",
    createResourceRoutes({
      syncRegistry: async () => {
        syncCalls++;
        return { entries: 1, fromRegistry: 1, fromAi: 0 };
      },
    }),
  );

  assert.equal(
    (await app.request("/resources/sync", { method: "POST" })).status,
    401,
  );
  for (const token of ["free-token", "premium-token"] as const) {
    const response = await app.request("/resources/sync", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-role": "admin",
        "x-admin": "true",
      },
    });
    assert.equal(response.status, 403);
  }
  assert.equal(syncCalls, 0);

  const adminResponse = await app.request("/resources/sync", {
    method: "POST",
    headers: { authorization: "Bearer admin-token" },
  });
  assert.equal(adminResponse.status, 200);
  assert.equal(syncCalls, 1);
});

test("resume upload accepts files through the limit and rejects oversized files before extraction", async () => {
  const uploadLimit = 1024;
  let extractCalls = 0;
  const app = new Hono();
  app.use("*", fixtureAuth());
  app.route(
    "/builder",
    createBuilderRoutes({
      env: { MAX_RESUME_UPLOAD_BYTES: String(uploadLimit) },
      extractPdf: async () => {
        extractCalls++;
        return { resume: {}, layoutFindings: [] } as never;
      },
    }),
  );

  for (const size of [uploadLimit - 1, uploadLimit]) {
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(size)], "resume.pdf", {
        type: "application/pdf",
      }),
    );
    const response = await app.request("/builder/upload", {
      method: "POST",
      headers: { authorization: "Bearer free-token" },
      body: form,
    });
    assert.equal(response.status, 200);
  }
  assert.equal(extractCalls, 2);

  const oversized = new FormData();
  oversized.set(
    "file",
    new File([new Uint8Array(uploadLimit + 1)], "resume.pdf", {
      type: "application/pdf",
    }),
  );
  const rejected = await app.request("/builder/upload", {
    method: "POST",
    headers: { authorization: "Bearer free-token" },
    body: oversized,
  });
  assert.equal(rejected.status, 413);
  assert.deepEqual(await rejected.json(), {
    error: "payload_too_large",
    maxBytes: uploadLimit,
  });
  assert.equal(extractCalls, 2);
});

test("private-only analysis routes are absent from the public edition", async () => {
  const app = new Hono();
  app.use("*", fixtureAuth());
  app.route("/builder", createBuilderRoutes());
  app.route("/listings", listingRoutes);

  for (const [path, method] of [
    ["/builder/improve-bullet", "POST"],
    ["/builder/audit", "POST"],
    ["/listings/example/intel", "POST"],
    ["/listings/example/tailor", "POST"],
  ] as const) {
    const response = await app.request(path, {
      method,
      headers: { authorization: "Bearer free-token" },
    });
    assert.equal(response.status, 404);
  }
});
