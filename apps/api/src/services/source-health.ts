import { eq } from "drizzle-orm";
import { db, sourceHealth, type Db } from "@aperture/db";
import { companyRegistry, registeredSourceConfig } from "./company-registry.js";
import { reconcileListings } from "./listing-reconciliation.js";
import type { JobSourceFetchResult } from "./job-source.js";
export async function recordJobSourceScan(sourceId: string, result: JobSourceFetchResult, database: Db = db(), registry = companyRegistry) {
  const config = registeredSourceConfig(sourceId, registry);
  if (!config.enabled || result.sourceId !== sourceId || result.provider !== config.provider || result.source !== config.source ||
      result.jobs.some(j => j.source !== config.source || result.snapshotComplete && j.namespace !== result.snapshotNamespace) ||
      result.snapshotComplete && (result.status !== "success" || !result.snapshotNamespace.startsWith(config.provider + ":")))
    throw new Error("InvalidJobSourceScan");
  return database.transaction(async tx => {
    await tx.insert(sourceHealth).values({ sourceId }).onConflictDoNothing();
    const [health] = await tx.select().from(sourceHealth).where(eq(sourceHealth.sourceId, sourceId)).for("update");
    if (health?.lastCheckedAt && health.lastCheckedAt > result.fetchedAt) return;
    if (result.status !== "failure") await reconcileListings(result.jobs, tx,
      result.snapshotComplete ? { source: config.source, namespace: result.snapshotNamespace, observedAt: result.fetchedAt } : undefined);
    const diagnostics = result.warnings.map(w => w.code);
    if (result.status === "failure") diagnostics.push("failure_kind:" + result.error.kind,
      "failure_code:" + result.error.code.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0,100), "failure_retryable:" + result.error.retryable);
    await tx.update(sourceHealth).set({ status: result.status === "failure" ? "failure" : result.status === "partial" ? "attention" : "healthy",
      lastCheckedAt: result.fetchedAt, ...(result.status === "failure" ? {} : { lastSuccessfulAt: result.fetchedAt }),
      recordsReceived: result.recordsReceived, durationMs: result.durationMs, diagnostics }).where(eq(sourceHealth.sourceId, sourceId));
  });
}
