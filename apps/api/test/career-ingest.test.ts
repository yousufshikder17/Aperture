import assert from "node:assert/strict";
import test from "node:test";
import { sourceHealth, type Db } from "@aperture/db";
import { AshbySourceSchema, LeverSourceSchema } from "@aperture/shared";
import { AshbyJobSourceAdapter } from "../src/services/ashby-source.js";
import { companyRegistry } from "../src/services/company-registry.js";
import { LeverJobSourceAdapter } from "../src/services/lever-source.js";
import { ingestCareerSource } from "../src/jobs/career-ingest.js";
import type { JobSourceFetchResult } from "../src/services/job-source.js";

for (const provider of ["lever", "ashby"] as const) test(`generic career worker skips disabled ${provider} sources and records failures before durable retry signalling`, async t => {
  const shared = { id: `worker-${provider}`, companyId: "example", enabled: false, intervalHours: 24, support: "supported" };
  const source = provider === "lever" ? LeverSourceSchema.parse({ ...shared, provider, site: "example" }) :
    AshbySourceSchema.parse({ ...shared, provider, boardName: "Example" });
  companyRegistry.sources.push(source);
  t.after(() => { companyRegistry.sources.splice(companyRegistry.sources.indexOf(source), 1); });
  let fetched = 0, retryable = true, reconciled = 0;
  let outcome: "failure" | "partial" | "success" = "failure";
  let saved: Record<string, unknown> = {};
  t.mock.method(provider === "lever" ? LeverJobSourceAdapter.prototype : AshbyJobSourceAdapter.prototype, "fetch", async (): Promise<JobSourceFetchResult> => {
    fetched++;
    const metadata = { provider, sourceId: source.id, source: "career_page" as const,
      fetchedAt: new Date(), durationMs: 1, recordsReceived: 0 };
    if (outcome === "success") return { ...metadata, status: "success", snapshotComplete: true,
      snapshotNamespace: provider === "ashby" ? "ashby:Example" : "lever:global%2Fexample", jobs: [], warnings: [] };
    if (outcome === "partial") return { ...metadata, status: "partial", snapshotComplete: false,
      jobs: [], warnings: [{ code: "invalid_record", count: 1 }] };
    return { provider, sourceId: source.id, source: "career_page", status: "failure", snapshotComplete: false,
      jobs: [], warnings: [], fetchedAt: new Date(), durationMs: 1, recordsReceived: 0,
      error: { kind: "source", code: "network_failure", retryable } };
  });
  const rows = [{ paused: false, consecutiveFailures: 0, baselineCount: null }];
  const tx = {
    execute: async () => { reconciled++; },
    transaction: async (run: (transaction: typeof tx) => Promise<unknown>): Promise<unknown> => run(tx),
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => {} }) }),
    select: () => ({ from: (table: unknown) => ({ where: () => {
      const values = table === sourceHealth ? rows : [];
      return Object.assign(Promise.resolve(values), { for: async () => values });
    } }) }),
    update: () => ({ set: (value: Record<string, unknown>) => { saved = value; return { where: async () => {} }; } }),
  };
  const database = { ...tx, transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx) } as unknown as Db;
  await ingestCareerSource(source.id, "disabled", database);
  assert.equal(fetched, 0);
  source.enabled = true;
  const company = companyRegistry.companies.find(c => c.id === "example")!;
  const previousEnabled = company.enabled; company.enabled = true; t.after(() => { company.enabled = previousEnabled; });
  await assert.rejects(ingestCareerSource(source.id, "retryable", database), { name: "CareerSourceUnavailable" });
  assert.equal(fetched, 1, "the adapter is invoked once, with no worker retry loop");
  assert.equal(saved.status, "failure"); assert.deepEqual(saved.diagnostics,
    ["failure_kind:source", "failure_code:network_failure", "failure_retryable:true"]);
  retryable = false;
  await ingestCareerSource(source.id, "non-retryable", database);
  assert.equal(fetched, 2); assert(saved.diagnostics && (saved.diagnostics as string[]).includes("failure_retryable:false"));
  assert.equal(reconciled, 0, "failed scans never authorize closure");
  outcome = "partial";
  await ingestCareerSource(source.id, "partial", database);
  assert.equal(saved.status, "attention"); assert.deepEqual(saved.diagnostics, ["invalid_record"]);
  assert.equal(reconciled, 0, "partial empty scans never authorize closure");
  outcome = "success";
  await ingestCareerSource(source.id, "complete-empty", database);
  assert.equal(reconciled, 1, "a complete empty snapshot reaches the existing reconciler");
  assert.equal(saved.status, "healthy"); assert.equal(saved.recordsReceived, 0);
});
