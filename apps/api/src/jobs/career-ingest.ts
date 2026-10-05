import { db, type Db } from "@aperture/db";
import { resolveCareerAdapter } from "../services/career-adapters.js";
import { recordJobSourceScan } from "../services/source-health.js";
export async function ingestCareerSource(sourceId: string, runId: string, database: Db = db()) {
  const { config, adapter } = resolveCareerAdapter(sourceId);
  if (!config.enabled) return;
  const result = await adapter.fetch({ runId, log: event => console.info("job_source_fetch", event) });
  await recordJobSourceScan(sourceId, result, database);
  if (result.status === "failure" && result.error.retryable) {
    const error = new Error("Career source temporarily unavailable"); error.name = "CareerSourceUnavailable"; throw error;
  }
}
