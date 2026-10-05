import assert from "node:assert/strict";
import test from "node:test";
import { providerNamespace, NormalizedJobSchema } from "../src/services/normalized-job.js";
import type { JobSourceFetchResult } from "../src/services/job-source.js";
test("provider scopes isolate legacy, boards and shared career source labels", () => {
  assert.equal(providerNamespace("greenhouse", "legacy"), "greenhouse:legacy");
  assert.equal(new Set(["legacy", providerNamespace("greenhouse", "board-a"), providerNamespace("greenhouse", "board-b"), providerNamespace("lever", "board-a"), providerNamespace("ashby", "board-a")]).size, 5);
  assert.equal(NormalizedJobSchema.shape.namespace.safeParse("legacy").success, false);
  assert.throws(() => providerNamespace("bad:provider", "scope"));
});
// These must fail typechecking; only complete successes may carry closure scope.
const check = () => {
  // @ts-expect-error complete snapshots require snapshotNamespace
  const missing: JobSourceFetchResult = { provider:"test", sourceId:"test", source:"career_page", fetchedAt:new Date(), durationMs:0, recordsReceived:0, status:"success", snapshotComplete:true, jobs:[], warnings:[] };
  // @ts-expect-error partial snapshots cannot authorize closure
  const partial: JobSourceFetchResult = { provider:"test", sourceId:"test", source:"career_page", fetchedAt:new Date(), durationMs:0, recordsReceived:0, status:"partial", snapshotComplete:true, snapshotNamespace:"test:scope", jobs:[], warnings:[] };
  return [missing, partial];
};
void check;
