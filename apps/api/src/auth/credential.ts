import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import {
  DEVELOPMENT_IDENTITIES,
  type DevelopmentIdentityName,
} from "./development-identities.js";

export interface VerifiedIdentity {
  subject: string;
  email: string;
  developmentIdentity?: DevelopmentIdentityName;
}

export type CredentialVerifier = (
  authorizationHeader: string | undefined,
) => Promise<VerifiedIdentity | null>;

export type AuthEnvironment = Record<string, string | undefined>;

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

function required(env: AuthEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new AuthConfigurationError(`${name} is required`);
  return value;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function equalSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function developmentVerifier(env: AuthEnvironment): CredentialVerifier {
  if (env.NODE_ENV === "production") {
    throw new AuthConfigurationError(
      "AUTH_MODE=development is forbidden when NODE_ENV=production",
    );
  }

  const credentials = Object.values(DEVELOPMENT_IDENTITIES).map((identity) => {
    const token = required(env, identity.tokenEnvironmentVariable);
    if (token.length < 32) {
      throw new AuthConfigurationError(
        `${identity.tokenEnvironmentVariable} must contain at least 32 characters`,
      );
    }
    return { identity, token };
  });
  if (
    new Set(credentials.map(({ token }) => token)).size !== credentials.length
  ) {
    throw new AuthConfigurationError(
      "development identity tokens must be distinct",
    );
  }

  return async (authorizationHeader) => {
    const supplied = bearerToken(authorizationHeader);
    if (!supplied) return null;
    const match = credentials.find(({ token }) => equalSecret(supplied, token));
    if (!match) return null;
    return {
      subject: match.identity.subject,
      email: match.identity.email,
      developmentIdentity: match.identity.name,
    };
  };
}

function oidcVerifier(
  env: AuthEnvironment,
  verificationKey?: JWTVerifyGetKey,
): CredentialVerifier {
  const issuer = required(env, "AUTH_ISSUER");
  const audience = required(env, "AUTH_AUDIENCE");
  const jwksUrl = new URL(required(env, "AUTH_JWKS_URL"));
  if (env.NODE_ENV === "production" && jwksUrl.protocol !== "https:") {
    throw new AuthConfigurationError(
      "AUTH_JWKS_URL must use HTTPS in production",
    );
  }

  const algorithms = (env.AUTH_ALLOWED_ALGORITHMS ?? "RS256")
    .split(",")
    .map((algorithm) => algorithm.trim())
    .filter(Boolean);
  if (algorithms.length === 0) {
    throw new AuthConfigurationError(
      "AUTH_ALLOWED_ALGORITHMS must not be empty",
    );
  }

  const key = verificationKey ?? createRemoteJWKSet(jwksUrl);

  return async (authorizationHeader) => {
    const token = bearerToken(authorizationHeader);
    if (!token) return null;

    try {
      const { payload } = await jwtVerify(token, key, {
        issuer,
        audience,
        algorithms,
        clockTolerance: 5,
      });

      if (
        typeof payload.sub !== "string" ||
        !payload.sub ||
        typeof payload.email !== "string" ||
        !payload.email ||
        payload.email_verified !== true
      ) {
        return null;
      }

      return {
        subject: payload.sub,
        email: payload.email.trim().toLowerCase(),
      };
    } catch {
      return null;
    }
  };
}

export function createCredentialVerifier(
  env: AuthEnvironment = process.env,
  verificationKey?: JWTVerifyGetKey,
): CredentialVerifier {
  const mode = required(env, "AUTH_MODE").toLowerCase();
  if (mode === "development") return developmentVerifier(env);
  if (mode === "oidc") return oidcVerifier(env, verificationKey);
  throw new AuthConfigurationError(`unsupported AUTH_MODE: ${mode}`);
}
