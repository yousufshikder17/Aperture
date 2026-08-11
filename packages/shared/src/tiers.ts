export type Tier = "free" | "pro";

/** Public-edition usage limits. Tiers do not grant private-only capabilities. */
export interface TierLimits {
  matchesPerMonth: number | null;
  archiveSaves: number | null;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { matchesPerMonth: 3, archiveSaves: 3 },
  pro: { matchesPerMonth: null, archiveSaves: null },
};
