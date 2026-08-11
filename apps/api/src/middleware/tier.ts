import { createMiddleware } from "hono/factory";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, usageCounters } from "@aperture/db";
import { TIER_LIMITS } from "@aperture/shared";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

async function counterRow(userId: string) {
  const month = currentMonth();
  const rows = await db()
    .insert(usageCounters)
    .values({ userId, month })
    .onConflictDoNothing()
    .returning();
  if (rows[0]) return rows[0];
  const existing = await db()
    .select()
    .from(usageCounters)
    .where(and(eq(usageCounters.userId, userId), eq(usageCounters.month, month)));
  return existing[0]!;
}

export type QuotaKind = "matches" | "saves";

/** Consume one public-edition metered unit for the verified principal. */
export function consumeQuota(kind: QuotaKind) {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");
    const limits = TIER_LIMITS[user.tier];
    const quota = {
      matches: {
        cap: limits.matchesPerMonth,
        used: (row: Awaited<ReturnType<typeof counterRow>>) => row.matchesUsed,
        column: usageCounters.matchesUsed,
        increment: { matchesUsed: sql`${usageCounters.matchesUsed} + 1` },
      },
      saves: {
        cap: limits.archiveSaves,
        used: (row: Awaited<ReturnType<typeof counterRow>>) => row.savesUsed,
        column: usageCounters.savesUsed,
        increment: { savesUsed: sql`${usageCounters.savesUsed} + 1` },
      },
    }[kind];

    if (quota.cap !== null) {
      const row = await counterRow(user.id);
      const used = quota.used(row);
      const updated = await db()
        .update(usageCounters)
        .set(quota.increment)
        .where(and(eq(usageCounters.id, row.id), lt(quota.column, quota.cap)))
        .returning({ id: usageCounters.id });
      if (!updated[0]) {
        return c.json(
          { error: "quota_exceeded", kind, cap: quota.cap, used, tier: user.tier },
          402,
        );
      }
    }
    await next();
  });
}
