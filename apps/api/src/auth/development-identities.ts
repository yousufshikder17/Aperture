import type { Tier } from "@aperture/shared";

export type ApplicationRole = "user" | "admin";
export type DevelopmentIdentityName =
  | "free_user"
  | "premium_user"
  | "admin_user";

export interface DevelopmentIdentity {
  name: DevelopmentIdentityName;
  id: string;
  subject: string;
  email: string;
  tier: Tier;
  role: ApplicationRole;
  tokenEnvironmentVariable: string;
}

// Stable, development-only fixtures. Tokens remain environment configuration;
// no credential is embedded here or provisioned in production.
export const DEVELOPMENT_IDENTITIES: Record<
  DevelopmentIdentityName,
  DevelopmentIdentity
> = {
  free_user: {
    name: "free_user",
    id: "00000000-0000-4000-8000-000000000001",
    subject: "development:free_user",
    email: "free_user@example.test",
    tier: "free",
    role: "user",
    tokenEnvironmentVariable: "AUTH_DEV_FREE_TOKEN",
  },
  premium_user: {
    name: "premium_user",
    id: "00000000-0000-4000-8000-000000000002",
    subject: "development:premium_user",
    email: "premium_user@example.test",
    tier: "pro",
    role: "user",
    tokenEnvironmentVariable: "AUTH_DEV_PREMIUM_TOKEN",
  },
  admin_user: {
    name: "admin_user",
    id: "00000000-0000-4000-8000-000000000003",
    subject: "development:admin_user",
    email: "admin_user@example.test",
    tier: "free",
    role: "admin",
    tokenEnvironmentVariable: "AUTH_DEV_ADMIN_TOKEN",
  },
};
