import assert from "node:assert/strict";
import test from "node:test";
import { NormalizedJobSchema, sourceIdentity, canonicalAvailability } from "../src/services/normalized-job.js";
import { normalizeRssItem } from "../src/services/rss-source.js";
import { parseFeed } from "../src/services/feed-reader.js";

test("RSS adapter preserves opaque GUIDs, scopes identity, validates URLs and does not infer closure", () => {
  const feed = { source: "linkedin_rss" as const, url: "https://example.test/feed" };
  const at = new Date("2026-10-01T00:00:00Z");
  const [item] = parseFeed('<rss><channel><item><guid isPermaLink="false">00012</guid><title>Engineer at Example</title><link>https://example.test/jobs/12?q=1</link><pubDate>invalid</pubDate></item></channel></rss>');
  const job = normalizeRssItem(item, feed, at)!;
  assert.equal(job.externalId, "00012"); assert.equal(sourceIdentity(job), "id:00012");
  assert.equal(job.company, "Example"); assert.equal(job.postedAt, null);
  assert.equal(job.availability, "unknown"); assert.equal(job.observedAt, at);
  assert.notEqual(normalizeRssItem(item, { ...feed, url: feed.url + "?tag=Engineer" }, at)!.namespace, job.namespace);
  const fallback = normalizeRssItem({ ...item, guid: undefined }, feed, at)!;
  assert.equal(sourceIdentity(fallback), "url:https://example.test/jobs/12?q=1");
  for (const link of ["javascript:alert(1)", "file:///job", "https://user:password@example.test/job", "/job"])
    assert.equal(normalizeRssItem({ ...item, link }, feed, at), null);
  assert.equal(normalizeRssItem(item, { ...feed, source: "manual" }, at), null);
  assert.equal(NormalizedJobSchema.safeParse({ ...job, observedAt: new Date("invalid") }).success, false);
  assert.equal(NormalizedJobSchema.safeParse({ ...job, namespace: "legacy" }).success, false);
});

test("availability requires all representations closed; missing and unknown evidence stay unknown", () => {
  assert.equal(canonicalAvailability([]), "unknown");
  assert.equal(canonicalAvailability(["closed", "unknown"]), "unknown");
  assert.equal(canonicalAvailability(["closed", "open"]), "open");
  assert.equal(canonicalAvailability(["closed", "closed"]), "closed");
});
