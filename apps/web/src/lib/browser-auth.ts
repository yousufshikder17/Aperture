import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, EncryptJWT, jwtDecrypt, jwtVerify } from "jose";

type Env = Record<string, string | undefined>;
export function authConfig(env: Env = process.env) {
  const production = env.NODE_ENV === "production";
  function url(value: string | undefined) {
    const parsed = new URL(value ?? "");
    if (parsed.username || parsed.password || parsed.hash ||
        (parsed.protocol !== "https:" && (production || parsed.protocol !== "http:" ||
          !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))))
      throw new Error("Authentication requires HTTPS (loopback HTTP is development-only)");
    return parsed;
  }
  const origin = url(env.WEB_APP_URL).origin;
  const issuer = url(env.WEB_OIDC_ISSUER).href;
  const clientId = env.WEB_OIDC_CLIENT_ID;
  if (!clientId || !/^[a-fA-F0-9]{64}$/.test(env.WEB_SESSION_SECRET ?? ""))
    throw new Error("Configure OIDC client and a random 32-byte hex session secret");
  return {
    origin, issuer, clientId, production,
    clientSecret: env.WEB_OIDC_CLIENT_SECRET,
    audience: env.WEB_OIDC_AUDIENCE,
    apiBase: url(env.API_BASE_URL ?? env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787").href.replace(/\/$/, ""),
    key: Buffer.from(env.WEB_SESSION_SECRET!, "hex"),
    redirectUri: origin + "/auth/callback",
    sessionCookie: production ? "__Host-aperture-session" : "aperture-session",
    flowCookie: production ? "__Host-aperture-flow" : "aperture-flow",
    validateUrl: url,
  };
}
export type AuthConfig = ReturnType<typeof authConfig>;
export const cookieOptions = (config: AuthConfig, maxAge: number) =>
  ({ httpOnly: true, secure: config.production || config.origin.startsWith("https:"), sameSite: "lax" as const, path: "/", maxAge });

export async function seal(config: AuthConfig, purpose: "flow" | "session", data: Record<string, unknown>, seconds: number) {
  const value = await new EncryptJWT(data).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(config.origin).setAudience(purpose).setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + seconds).encrypt(config.key);
  if (value.length > 3800) throw new Error("Session exceeds cookie size limit");
  return value;
}
export async function unseal(config: AuthConfig, purpose: "flow" | "session", value?: string) {
  if (!value) return null;
  try {
    return (await jwtDecrypt(value, config.key, { issuer: config.origin, audience: purpose,
      keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] })).payload;
  } catch { return null; }
}

async function discovery(config: AuthConfig) {
  const response = await fetch(config.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration",
    { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Identity provider unavailable");
  const metadata = await response.json();
  if (metadata.issuer !== config.issuer) throw new Error("Issuer mismatch");
  return {
    authorization: config.validateUrl(metadata.authorization_endpoint),
    token: config.validateUrl(metadata.token_endpoint),
    jwks: config.validateUrl(metadata.jwks_uri),
  };
}

export async function beginLogin(config: AuthConfig) {
  const metadata = await discovery(config);
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
    response_type: "code", response_mode: "query", scope: "openid profile email", state, nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  if (config.audience) params.set("audience", config.audience);
  metadata.authorization.search = params.toString();
  return { location: metadata.authorization.href, cookie: await seal(config, "flow", { verifier, state, nonce }, 600) };
}

export async function completeLogin(config: AuthConfig, callback: URL, cookie?: string) {
  const flow = await unseal(config, "flow", cookie);
  if (!flow || typeof flow.verifier !== "string" || typeof flow.nonce !== "string" ||
      callback.searchParams.getAll("state").length !== 1 ||
      callback.searchParams.get("state") !== flow.state || callback.searchParams.has("error") ||
      callback.searchParams.getAll("code").length !== 1 || !callback.searchParams.get("code"))
    throw new Error("Invalid or expired sign-in");
  if (callback.searchParams.has("iss") && callback.searchParams.get("iss") !== config.issuer)
    throw new Error("Authorization issuer mismatch");
  const metadata = await discovery(config);
  const body = new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId,
    redirect_uri: config.redirectUri, code: callback.searchParams.get("code")!, code_verifier: flow.verifier });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (config.clientSecret) {
    const encode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
    headers.authorization = "Basic " + Buffer.from(encode(config.clientId) + ":" + encode(config.clientSecret)).toString("base64");
  }
  const response = await fetch(metadata.token, { method: "POST", headers, body, redirect: "error",
    cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Code exchange failed");
  const tokens = await response.json();
  if (typeof tokens.id_token !== "string" || typeof tokens.access_token !== "string" ||
      String(tokens.token_type).toLowerCase() !== "bearer" ||
      !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0)
    throw new Error("Invalid token response");
  const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(metadata.jwks), {
    issuer: config.issuer, audience: config.clientId, algorithms: ["RS256", "ES256"],
    requiredClaims: ["sub", "iat", "exp", "nonce"],
  });
  if (payload.nonce !== flow.nonce || !payload.sub ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId) ||
      (payload.azp !== undefined && payload.azp !== config.clientId))
    throw new Error("Invalid identity token");
  // The API remains authoritative for accepted credentials, verified email, and entitlement.
  const principal = await fetch(config.apiBase + "/v1/auth/me", {
    headers: { authorization: "Bearer " + tokens.access_token }, cache: "no-store",
    redirect: "error", signal: AbortSignal.timeout(10000),
  });
  if (!principal.ok) throw new Error("API rejected identity");
  const seconds = Math.floor(Math.min(3600, tokens.expires_in, payload.exp! - Date.now() / 1000));
  if (seconds < 1) throw new Error("Expired identity");
  return { cookie: await seal(config, "session", { token: tokens.access_token }, seconds), seconds };
}

export async function sessionToken(value?: string, env: Env = process.env) {
  if (value) {
    const payload = await unseal(authConfig(env), "session", value);
    return typeof payload?.token === "string" ? payload.token : null;
  }
  return env.NODE_ENV !== "production" && !env.WEB_OIDC_CLIENT_ID
    ? env.AUTH_DEV_WEB_TOKEN ?? env.NEXT_PUBLIC_AUTH_DEV_TOKEN ?? null : null;
}

export function sameOrigin(request: Request, origin: string) {
  return request.headers.get("origin") === origin &&
    request.headers.get("sec-fetch-site") !== "cross-site";
}
