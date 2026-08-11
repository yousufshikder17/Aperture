import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import {
  AuthConfigurationError,
  createCredentialVerifier,
  type CredentialVerifier,
  type VerifiedIdentity,
} from "../src/auth/credential.js";
import {
  applicationRoleForIdentity,
  createAuthMiddleware,
  type AuthenticatedUser,
} from "../src/middleware/auth.js";
import { DEVELOPMENT_IDENTITIES } from "../src/auth/development-identities.js";

const userA: AuthenticatedUser = {
  id: "user-a-id",
  email: "user-a@example.com",
  subject: "subject-a",
  role: "user",
  tier: "free",
  orgId: null,
};

const userB: AuthenticatedUser = {
  id: "user-b-id",
  email: "user-b@example.com",
  subject: "subject-b",
  role: "user",
  tier: "pro",
  orgId: null,
};

function testApp() {
  const identities = new Map<string, VerifiedIdentity>([
    ["token-a", { subject: userA.subject, email: userA.email }],
    ["token-b", { subject: userB.subject, email: userB.email }],
  ]);
  const users = new Map([
    [userA.subject, userA],
    [userB.subject, userB],
  ]);

  const verifyCredential: CredentialVerifier = async (authorization) => {
    const token = /^Bearer ([^\s]+)$/i.exec(authorization ?? "")?.[1];
    return token ? (identities.get(token) ?? null) : null;
  };

  const app = new Hono();
  app.use(
    "*",
    createAuthMiddleware({
      verifyCredential,
      resolvePrincipal: async (identity) => {
        const user = users.get(identity.subject);
        if (!user) throw new Error("unknown test identity");
        return user;
      },
    }),
  );

  app.get("/me", (c) => c.json(c.get("user")));
  app.get("/records/:id", (c) => {
    const ownerId = c.req.param("id") === "record-b" ? userB.id : userA.id;
    if (ownerId !== c.get("user").id)
      return c.json({ error: "not_found" }, 404);
    return c.json({ id: c.req.param("id"), ownerId });
  });

  return app;
}

test("A: protected route rejects a request without a credential", async () => {
  const response = await testApp().request("/me");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthenticated" });
});

test("B: spoofed identity and privilege headers cannot replace User A", async () => {
  const response = await testApp().request("/me", {
    headers: {
      authorization: "Bearer token-a",
      "x-user-email": userB.email,
      "x-user-id": userB.id,
      "x-role": "admin",
      "x-tier": "pro",
      "x-tenant-id": "other-tenant",
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), userA);
});

test("C: x-user-email alone cannot authenticate an anonymous caller", async () => {
  const response = await testApp().request("/me", {
    headers: { "x-user-email": userB.email },
  });
  assert.equal(response.status, 401);
});

test("D: spoofed headers cannot cross a user-owned resource boundary", async () => {
  const response = await testApp().request("/records/record-b", {
    headers: {
      authorization: "Bearer token-a",
      "x-user-email": userB.email,
      "x-user-id": userB.id,
      "x-account-id": userB.id,
    },
  });
  assert.equal(response.status, 404);
});

test("F: a valid credential authenticates its legitimate user", async () => {
  const response = await testApp().request("/me", {
    headers: { authorization: "Bearer token-b" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), userB);
});

test("F: OIDC mode cryptographically verifies issuer, audience, signature, and claims", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const keySet = createLocalJWKSet({
    keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }],
  });
  const env = {
    NODE_ENV: "production",
    AUTH_MODE: "oidc",
    AUTH_ISSUER: "https://issuer.example.com/",
    AUTH_AUDIENCE: "https://api.example.com",
    AUTH_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
    AUTH_ALLOWED_ALGORITHMS: "RS256",
  };
  const token = await new SignJWT({ email: userA.email, email_verified: true })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(userA.subject)
    .setIssuer(env.AUTH_ISSUER)
    .setAudience(env.AUTH_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const wrongAudienceToken = await new SignJWT({
    email: userA.email,
    email_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(userA.subject)
    .setIssuer(env.AUTH_ISSUER)
    .setAudience("https://different-api.example.com")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const unverifiedEmailToken = await new SignJWT({
    email: userA.email,
    email_verified: false,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(userA.subject)
    .setIssuer(env.AUTH_ISSUER)
    .setAudience(env.AUTH_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const verify = createCredentialVerifier(env, keySet);
  assert.deepEqual(await verify(`Bearer ${token}`), {
    subject: userA.subject,
    email: userA.email,
  });
  assert.equal(await verify(`Bearer ${wrongAudienceToken}`), null);
  assert.equal(await verify(`Bearer ${unverifiedEmailToken}`), null);
  assert.equal(await verify("Bearer not-a-jwt"), null);
});

test("G: development credential is explicit and rejected in production", async () => {
  const developmentEnv = {
    NODE_ENV: "development",
    AUTH_MODE: "development",
    AUTH_DEV_FREE_TOKEN: "free-development-token-with-at-least-32-characters",
    AUTH_DEV_PREMIUM_TOKEN:
      "premium-development-token-with-at-least-32-characters",
    AUTH_DEV_ADMIN_TOKEN: "admin-development-token-with-at-least-32-characters",
  };
  const verify = createCredentialVerifier(developmentEnv);

  assert.deepEqual(
    await verify(`Bearer ${developmentEnv.AUTH_DEV_FREE_TOKEN}`),
    {
      subject: DEVELOPMENT_IDENTITIES.free_user.subject,
      email: DEVELOPMENT_IDENTITIES.free_user.email,
      developmentIdentity: "free_user",
    },
  );
  assert.deepEqual(
    await verify(`Bearer ${developmentEnv.AUTH_DEV_PREMIUM_TOKEN}`),
    {
      subject: DEVELOPMENT_IDENTITIES.premium_user.subject,
      email: DEVELOPMENT_IDENTITIES.premium_user.email,
      developmentIdentity: "premium_user",
    },
  );
  assert.deepEqual(
    await verify(`Bearer ${developmentEnv.AUTH_DEV_ADMIN_TOKEN}`),
    {
      subject: DEVELOPMENT_IDENTITIES.admin_user.subject,
      email: DEVELOPMENT_IDENTITIES.admin_user.email,
      developmentIdentity: "admin_user",
    },
  );
  assert.equal(await verify(undefined), null);
  assert.equal(await verify("Bearer wrong-token"), null);

  assert.throws(
    () =>
      createCredentialVerifier({ ...developmentEnv, NODE_ENV: "production" }),
    AuthConfigurationError,
  );
});

test("G: missing authentication configuration fails closed", () => {
  assert.throws(
    () => createCredentialVerifier({ NODE_ENV: "production" }),
    AuthConfigurationError,
  );
});

test("admin role is derived only from the server-side verified-subject allowlist", () => {
  const identity = {
    subject: "operator-subject",
    email: "operator@example.com",
  };
  assert.equal(
    applicationRoleForIdentity(identity, {
      AUTH_ADMIN_SUBJECTS: "operator-subject",
    }),
    "admin",
  );
  assert.equal(
    applicationRoleForIdentity(identity, {
      AUTH_ADMIN_SUBJECTS: "someone-else",
    }),
    "user",
  );
});
