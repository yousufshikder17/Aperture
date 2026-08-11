import { createMiddleware } from "hono/factory";
import { and, eq, isNull } from "drizzle-orm";
import { db, users } from "@aperture/db";
import type { Tier } from "@aperture/shared";
import {
  type AuthEnvironment,
  createCredentialVerifier,
  type CredentialVerifier,
  type VerifiedIdentity,
} from "../auth/credential.js";
import {
  DEVELOPMENT_IDENTITIES,
  type ApplicationRole,
} from "../auth/development-identities.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  subject: string;
  role: ApplicationRole;
  tier: Tier;
  orgId: string | null;
}

export type PrincipalResolver = (
  identity: VerifiedIdentity,
) => Promise<AuthenticatedUser>;

declare module "hono" {
  interface ContextVariableMap {
    user: AuthenticatedUser;
  }
}

export function applicationRoleForIdentity(
  identity: VerifiedIdentity,
  env: AuthEnvironment,
): ApplicationRole {
  if (identity.developmentIdentity) {
    return DEVELOPMENT_IDENTITIES[identity.developmentIdentity].role;
  }
  const adminSubjects = new Set(
    (env.AUTH_ADMIN_SUBJECTS ?? "")
      .split(",")
      .map((subject) => subject.trim())
      .filter(Boolean),
  );
  return adminSubjects.has(identity.subject) ? "admin" : "user";
}

async function resolveDatabaseUser(
  identity: VerifiedIdentity,
  env: AuthEnvironment,
): Promise<AuthenticatedUser> {
  const fixture = identity.developmentIdentity
    ? DEVELOPMENT_IDENTITIES[identity.developmentIdentity]
    : undefined;
  const foundBySubject = await db()
    .select()
    .from(users)
    .where(eq(users.authSubject, identity.subject))
    .limit(1);
  let user = foundBySubject[0];

  if (!user) {
    const legacyRows = await db()
      .select()
      .from(users)
      .where(eq(users.email, identity.email))
      .limit(1);
    const legacyUser = legacyRows[0];

    if (legacyUser) {
      if (legacyUser.authSubject !== null) {
        throw new Error(
          "verified subject does not match the account already bound to this email",
        );
      }
      const linked = await db()
        .update(users)
        .set({
          authSubject: identity.subject,
          tier: fixture?.tier ?? legacyUser.tier,
        })
        .where(and(eq(users.id, legacyUser.id), isNull(users.authSubject)))
        .returning();
      user = linked[0];
    } else {
      const inserted = await db()
        .insert(users)
        .values({
          id: fixture?.id,
          authSubject: identity.subject,
          email: identity.email,
          tier: fixture?.tier,
        })
        .onConflictDoNothing()
        .returning();
      user = inserted[0];
    }

    if (!user) {
      const concurrent = await db()
        .select()
        .from(users)
        .where(eq(users.authSubject, identity.subject))
        .limit(1);
      user = concurrent[0];
    }
  }

  if (user && fixture && user.tier !== fixture.tier) {
    const updated = await db()
      .update(users)
      .set({ tier: fixture.tier })
      .where(eq(users.id, user.id))
      .returning();
    user = updated[0] ?? user;
  }

  if (!user) throw new Error("failed to resolve authenticated database user");

  return {
    id: user.id,
    email: user.email,
    subject: identity.subject,
    role: applicationRoleForIdentity(identity, env),
    tier: user.tier,
    orgId: user.orgId,
  };
}

export interface AuthMiddlewareOptions {
  env?: AuthEnvironment;
  verifyCredential?: CredentialVerifier;
  resolvePrincipal?: PrincipalResolver;
}

// The Authorization bearer credential is the only identity input. Caller-supplied
// identity, role, tenant, and tier headers are deliberately ignored.
export function createAuthMiddleware(options: AuthMiddlewareOptions = {}) {
  const env = options.env ?? process.env;
  const verifyCredential =
    options.verifyCredential ?? createCredentialVerifier(env);
  const resolvePrincipal =
    options.resolvePrincipal ??
    ((identity) => resolveDatabaseUser(identity, env));

  return createMiddleware(async (c, next) => {
    const identity = await verifyCredential(c.req.header("authorization"));
    if (!identity) return c.json({ error: "unauthenticated" }, 401);

    const user = await resolvePrincipal(identity);
    c.set("user", user);
    await next();
  });
}
