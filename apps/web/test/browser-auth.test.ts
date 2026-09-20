import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authConfig, beginLogin, completeLogin, cookieOptions, seal, unseal, sessionToken, sameOrigin } from "../src/lib/browser-auth.js";

const env = {
  WEB_APP_URL: "http://localhost:3000", WEB_OIDC_ISSUER: "http://localhost:9000/",
  WEB_OIDC_CLIENT_ID: "web", WEB_SESSION_SECRET: "ab".repeat(32),
  API_BASE_URL: "http://localhost:8787", NODE_ENV: "test",
};
test("session encryption rejects tampering, expiration, wrong purpose and key", async () => {
  const config = authConfig(env);
  const cookie = await seal(config, "session", { token: "private-token" }, 60);
  assert.ok(!cookie.includes("private-token"));
  assert.equal((await unseal(config, "session", cookie))?.token, "private-token");
  assert.equal(await unseal(config, "flow", cookie), null);
  assert.equal(await unseal(config, "session", cookie.slice(0, -8) + "AAAAAAAA"), null);
  assert.equal(await unseal(config, "session", await seal(config, "session", {}, -1)), null);
  assert.equal(await unseal(authConfig({ ...env, WEB_SESSION_SECRET: "cd".repeat(32) }), "session", cookie), null);
  assert.equal(await sessionToken(undefined, { NODE_ENV: "production", NEXT_PUBLIC_AUTH_DEV_TOKEN: "unsafe" }), null);
  assert.equal(await sessionToken(undefined, { ...env, AUTH_DEV_WEB_TOKEN: "fallback-must-not-apply" }), null);
  assert.equal(await sessionToken(undefined, { NODE_ENV: "test", AUTH_DEV_WEB_TOKEN: "local" }), "local");
  assert.deepEqual(cookieOptions(config, 60), { httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 60 });
  await assert.rejects(seal(config, "session", { token: "a".repeat(4000) }, 60));
});
test("configuration and CSRF checks fail closed", () => {
  assert.throws(() => authConfig({ ...env, NODE_ENV: "production" }));
  assert.throws(() => authConfig({ ...env, WEB_SESSION_SECRET: "short" }));
  assert.throws(() => authConfig({ ...env, WEB_OIDC_ISSUER: "http://untrusted.test" }));
  assert.equal(sameOrigin(new Request(env.WEB_APP_URL, { headers: { origin: env.WEB_APP_URL } }), env.WEB_APP_URL), true);
  assert.equal(sameOrigin(new Request(env.WEB_APP_URL, { headers: { origin: "https://attacker.test" } }), env.WEB_APP_URL), false);
  assert.equal(sameOrigin(new Request(env.WEB_APP_URL), env.WEB_APP_URL), false);
});

test("OIDC integration: discovery, PKCE exchange, signed identity, API acceptance and failure regressions", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test", alg: "RS256", use: "sig" };
  let issuer = "", nonce = "", challenge = "", wrongNonce = false, rejectApi = false, exchanges = 0;
  const used = new Set<string>();
  const server = createServer(async (req, res) => {
    const send = (data: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
    };
    if (req.url === "/.well-known/openid-configuration")
      return send({ issuer, authorization_endpoint: issuer + "authorize", token_endpoint: issuer + "token", jwks_uri: issuer + "jwks" });
    if (req.url === "/jwks") return send({ keys: [jwk] });
    if (req.url === "/v1/auth/me") {
      assert.equal(req.headers.authorization, "Bearer synthetic-access");
      return send({ id: "synthetic-user" }, rejectApi ? 401 : 200);
    }
    if (req.url === "/token") {
      exchanges++;
      let body = "";
      for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body);
      assert.equal(params.get("grant_type"), "authorization_code");
      assert.equal(params.get("redirect_uri"), env.WEB_APP_URL + "/auth/callback");
      assert.equal(createHash("sha256").update(params.get("code_verifier")!).digest("base64url"), challenge);
      const code = params.get("code")!;
      if (used.has(code)) return send({ error: "invalid_grant" }, 400);
      used.add(code);
      const id = await new SignJWT({ nonce: wrongNonce ? "wrong" : nonce })
        .setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer(issuer).setAudience("web")
        .setSubject("synthetic-user").setIssuedAt().setExpirationTime("5m").sign(privateKey);
      return send({ id_token: id, access_token: "synthetic-access", token_type: "Bearer", expires_in: 300 });
    }
    send({}, 404);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  issuer = "http://127.0.0.1:" + (server.address() as { port: number }).port + "/";
  try {
    const config = authConfig({ ...env, WEB_OIDC_ISSUER: issuer, API_BASE_URL: issuer });
    const login = await beginLogin(config);
    const location = new URL(login.location);
    nonce = location.searchParams.get("nonce")!;
    challenge = location.searchParams.get("code_challenge")!;
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.equal(location.searchParams.get("response_type"), "code");
    const callback = new URL(config.redirectUri);
    callback.searchParams.set("state", "wrong");
    callback.searchParams.set("code", "one");
    await assert.rejects(completeLogin(config, callback, login.cookie));
    assert.equal(exchanges, 0);
    callback.searchParams.set("state", location.searchParams.get("state")!);
    const result = await completeLogin(config, callback, login.cookie);
    assert.equal((await unseal(config, "session", result.cookie))?.token, "synthetic-access");
    assert.ok(result.seconds <= 300);
    await assert.rejects(completeLogin(config, callback, login.cookie), /exchange/);
    callback.searchParams.set("code", "two");
    wrongNonce = true;
    await assert.rejects(completeLogin(config, callback, login.cookie), /identity/);
    callback.searchParams.set("code", "three");
    wrongNonce = false;
    rejectApi = true;
    await assert.rejects(completeLogin(config, callback, login.cookie), /API rejected/);
    await assert.rejects(completeLogin(config, callback), /expired/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
