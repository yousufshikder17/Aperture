import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AshbyJobSourceAdapter } from "../src/services/ashby-source.js";
import type { JobSourceFetchResult } from "../src/services/job-source.js";

test("generic read-only validator resolves Ashby from temporary config and never persists activation or fetch results", async t => {
  const directory = mkdtempSync(join(tmpdir(), "aperture-validator-test-"));
  const file = join(directory, "registry.json");
  const contents = JSON.stringify({ companies: [{ id: "example", slug: "example", name: "Example Co",
    careersUrl: "https://example.test/careers", enabled: false, tags: [] }], sources: [{ provider: "ashby", id: "test-ashby",
    companyId: "example", boardName: "Example", enabled: false, support: "unvalidated", intervalHours: 24 }] });
  writeFileSync(file, contents);
  const previousArgv = process.argv, previousExitCode = process.exitCode;
  t.after(() => { process.argv = previousArgv; process.exitCode = previousExitCode; rmSync(directory, { recursive: true }); });
  let fetched = 0;
  t.mock.method(AshbyJobSourceAdapter.prototype, "fetch", async function (source, context): Promise<JobSourceFetchResult> {
    fetched++; assert.equal(source.config.boardName, "Example"); assert.equal(source.enabled, true);
    assert.equal(source.config.support, "supported"); assert.equal(typeof context.log, "function");
    return { provider: "ashby", sourceId: "test-ashby", source: "career_page", status: "success", snapshotComplete: true,
      snapshotNamespace: "ashby:Example", jobs: [], warnings: [], fetchedAt: new Date("2026-10-04T12:00:00Z"), recordsReceived: 0, durationMs: 1 };
  });
  const output: string[] = [];
  t.mock.method(console, "info", (value: string) => output.push(value));
  process.argv = [process.execPath, "source-pilot.ts", "test-ashby", file];
  await import("../src/jobs/source-pilot.js");
  assert.equal(fetched, 1); assert.equal(readFileSync(file, "utf8"), contents);
  assert.deepEqual(JSON.parse(output[0]!), { provider: "ashby", sourceId: "test-ashby", status: "success", snapshotComplete: true,
    snapshotNamespace: "ashby:Example", recordsReceived: 0, normalized: 0, warnings: [], examples: [] });
  assert.equal(process.exitCode, previousExitCode);
});
