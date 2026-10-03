import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { RssJobSourceAdapter, rssSourceConfig } from "../src/services/rss-source.js";
import { NormalizedJobSchema } from "../src/services/normalized-job.js";
import { configuredSources } from "../src/services/source-config.js";
import { readFeed } from "../src/services/feed-reader.js";

const feed = { source: "linkedin_rss" as const, url: "https://example.test/feed" };
const xml = '<rss><channel><item><guid isPermaLink="false">00012</guid><title>Engineer at Example</title><link>https://example.test/jobs/12?q=1</link></item></channel></rss>';
const source = rssSourceConfig(feed);

test("provider-agnostic execution accepts normalized results without RSS-specific configuration", async () => {
  const { scanSources } = await import("../src/services/aggregator.js");
  const rssResult = await adapter(async () => new Response(xml)).fetch(source);
  assert(rssResult.status !== "failure");
  const received: unknown[] = [];
  let executions = 0;
  const config = { provider: "fixture", sourceId: "fixture:board", source: "career_page" as const,
    enabled: true, config: { board: "example" } };
  const result = await scanSources([config, { ...config, enabled: false }], {
    provider: "fixture",
    async fetch(input) {
      executions++;
      assert.equal(input.config.board, "example");
      return { ...rssResult, provider: "fixture", sourceId: input.sourceId, source: input.source,
        jobs: rssResult.jobs.map(job => ({ ...job, source: input.source, namespace: input.sourceId })) };
    },
  }, { reconcile: async jobs => { received.push(...jobs); return [{ listingId: "canonical", outcome: "created", changed: false, stale: false }]; },
    context: { log: () => {} } });
  assert.equal(executions, 1);
  assert.equal(result.configured, 1);
  assert.equal(result.inserted, 1);
  assert.equal(NormalizedJobSchema.parse(received[0]).namespace, "fixture:board");
});

test("scans preserve API summary shape, report bad configuration, and propagate persistence failures", async () => {
  const { scanFeeds } = await import("../src/services/aggregator.js");
  const empty = await scanFeeds({ feeds: [feed], fetch: async () => new Response('<rss><channel/></rss>'),
    reconcile: async () => { throw new Error("empty feed must not write"); }, context: { log: () => {} } });
  assert.deepEqual(empty, { configured: 1, scanned: 0, inserted: 0, succeeded: 1, failedSources: [] });
  const failed = await scanFeeds({ feeds: [{ ...feed, url: "invalid" }], context: { log: () => {} } });
  assert.deepEqual(failed, { configured: 1, scanned: 0, inserted: 0, succeeded: 0, failedSources: [feed.source] });
  await assert.rejects(scanFeeds({ feeds: [feed], fetch: async () => new Response(xml),
    reconcile: async () => { throw new Error("database failure"); }, context: { log: () => {} } }), /database failure/);
});

test("a source failure does not prevent other RSS feeds from reaching reconciliation", async () => {
  const { scanFeeds } = await import("../src/services/aggregator.js");
  const events: { status: string }[] = [];
  const result = await scanFeeds({ feeds: [feed, { source: "indeed_rss", url: "https://example.test/down" }],
    fetch: async url => {
      if (String(url).endsWith("down")) throw new Error("network");
      return new Response(xml);
    }, reconcile: async jobs => {
      assert.equal(jobs[0]?.namespace, source.sourceId);
      return [{ listingId: "canonical", outcome: "unchanged", changed: false, stale: false }];
    }, context: { log: event => events.push(event) } });
  assert.equal(result.scanned, 1);
  assert.equal(result.succeeded, 1);
  assert.deepEqual(result.failedSources, ["indeed_rss"]);
  assert.deepEqual(events.map(event => event.status), ["success", "failure"]);
});
function adapter(fetcher: typeof fetch) { return new RssJobSourceAdapter((url, context) => readFeed(url, fetcher, context)); }

test("RSS adapter preserves stable feed identity and validates its normalized output", async () => {
  const at = new Date("2026-10-01T00:00:00Z");
  const events: unknown[] = [];
  const result = await adapter(async () => new Response(xml)).fetch(source, { now: () => at, runId: "test", log: event => events.push(event) });
  assert.equal(result.status, "success");
  assert.equal(result.provider, "rss");
  assert.equal(result.sourceId, "rss:" + createHash("sha256").update(feed.url).digest("hex"));
  assert.equal(result.recordsReceived, 1);
  assert.equal(result.snapshotComplete, false);
  const job = NormalizedJobSchema.parse(result.jobs[0]);
  assert.equal(job.namespace, result.sourceId);
  assert.equal(job.externalId, "00012");
  assert.equal(job.url, "https://example.test/jobs/12?q=1");
  assert.equal(job.source, feed.source);
  assert.equal(job.observedAt.getTime(), at.getTime());
  assert.equal(job.availability, "unknown");
  assert.equal(events.length, 1);
  assert(!JSON.stringify(events).includes("https://"));
  assert(!JSON.stringify(events).includes("description"));
  assert.equal((await adapter(async () => new Response(xml)).fetch(source, { log: () => { throw new Error(); } })).status, "success");
});

test("empty RSS is successful while rejected records produce a partial result", async () => {
  for (const text of ['<rss><channel><title>Jobs</title></channel></rss>', '<rss><channel/></rss>']) {
    const result = await adapter(async () => new Response(text)).fetch(source);
    assert.equal(result.status, "success");
    assert.deepEqual(result.jobs, []);
    assert.equal(result.recordsReceived, 0);
    assert.equal(result.snapshotComplete, false);
  }
  const result = await adapter(async () => new Response(xml.replace('</channel>', '<item><title>Invalid</title><link>javascript:alert(1)</link></item></channel>'))).fetch(source);
  assert.equal(result.status, "partial");
  assert.equal(result.recordsReceived, 2);
  assert.equal(result.jobs.length, 1);
  assert.deepEqual(result.warnings, [{ code: "invalid_record", count: 1 }]);
  const rejected = await adapter(async () => new Response('<rss><channel><item>bad</item></channel></rss>')).fetch(source);
  assert.equal(rejected.status, "partial");
  assert.equal(rejected.jobs.length, 0);
});

test("payload, HTTP and network failures cannot masquerade as successful empty feeds", async () => {
  for (const text of ["<rss>", "<html>wrong</html>", "<rss><channel/><channel/></rss>"]) {
    const result = await adapter(async () => new Response(text)).fetch(source);
    assert.equal(result.status, "failure");
    assert.equal(result.error?.kind, "payload");
    assert.equal(result.error?.retryable, false);
    assert.deepEqual(result.jobs, []);
  }
  for (const status of [404, 429, 503]) {
    const result = await adapter(async () => new Response("secret response", { status })).fetch(source);
    assert.equal(result.status, "failure");
    assert.equal(result.error?.kind, "source");
    assert.equal(result.error?.retryable, status !== 404);
    assert(!JSON.stringify(result).includes("secret"));
  }
  let calls = 0;
  const rss = adapter(async () => { calls++; throw new Error("secret network details"); });
  const result = await rss.fetch(source);
  assert.equal(result.error?.code, "network_error");
  assert.equal(result.error?.retryable, true);
  assert.equal(calls, 1, "adapter has no retry loop");
  assert(!JSON.stringify(result).includes("secret"));
});

test("invalid source configuration fails before retrieving any data", async () => {
  let calls = 0;
  const rss = adapter(async () => { calls++; return new Response(xml); });
  for (const url of ["not a URL", "file:///jobs", "https://user:secret@example.test/feed"]) {
    const result = await rss.fetch(rssSourceConfig({ ...feed, url }));
    assert.equal(result.error?.kind, "configuration");
    assert.equal(result.error?.retryable, false);
  }
  for (const invalid of [{ ...source, enabled: false }, { ...source, provider: "other" }, { ...source, sourceId: "changed" }]) {
    assert.equal((await rss.fetch(invalid)).error?.kind, "configuration");
  }
  assert.equal((await rss.fetch(source, { timeoutMs: 0 })).error?.kind, "configuration");
  assert.equal(calls, 0);
});

test("caller cancellation and timeout reach RSS transport; cancellation is not retried", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const rss = adapter(async (_url, init) => { calls++; assert(init?.signal); return new Response(xml); });
  const cancelled = await rss.fetch(source, { signal: controller.signal });
  assert.equal(cancelled.error?.code, "aborted");
  assert.equal(cancelled.error?.retryable, false);
  assert.equal(calls, 0);
  assert.equal((await rss.fetch(source, { timeoutMs: 1000 })).status, "success");
  assert.equal(calls, 1);
});

test("LinkedIn and Indeed labels are RSS providers with independently scoped identities", async () => {
  for (const label of ["linkedin_rss", "indeed_rss"] as const) {
    const config = rssSourceConfig({ source: label, url: "https://example.test/" + label });
    assert.equal(config.provider, "rss");
    const result = await adapter(async () => new Response(xml)).fetch(config);
    assert.equal(result.status, "success");
    assert.equal(result.jobs[0]?.source, label);
    assert.equal(result.jobs[0]?.namespace, config.sourceId);
  }
});

test("public config remains operator-only without personalized or default Jobicy sources", () => {
  assert(configuredSources({}).every(source => !source.enabled));
  const configs = configuredSources({ LINKEDIN_RSS_URL: "https://example.test/linkedin",
    INDEED_RSS_URL: "https://example.test/indeed", JOBICY_RSS_URL: "https://example.test/ignored" });
  assert.equal(configs.length, 2);
  assert(configs.every(source => source.provider === "rss" && source.enabled));
  assert.deepEqual(configs.map(source => source.source), ["linkedin_rss", "indeed_rss"]);
});
