import { configuredFeeds } from "../src/services/source-config.js";
import assert from "node:assert/strict";
import test from "node:test";
import { NormalizedJobSchema, sourceIdentity, canonicalAvailability } from "../src/services/normalized-job.js";
import { normalizeRssItem } from "../src/services/rss-source.js";
import { parseFeed } from "../src/services/feed-reader.js";
import { readFileSync } from "node:fs";

test("RSS adapter preserves opaque GUIDs, scopes identity, validates URLs and does not infer closure", () => {
  const feed = { source: "jobicy" as const, url: "https://example.test/feed" };
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

test("Jobicy RSS preserves explicit company/location, full sanitized content, provenance and employment/category metadata", () => {
  const xml = readFileSync(new URL("./fixtures/jobicy-rss.xml", import.meta.url), "utf8");
  const feed = { source: "jobicy" as const, url: "https://example.test/jobicy-feed" };
  const items = parseFeed(xml), at = new Date("2026-10-05T12:00:00Z");
  const first = normalizeRssItem(items[0], feed, at)!;
  assert.equal(first.title, "Solutions Architect for Automotive"); assert.equal(first.company, "Example Company");
  assert.equal(first.location, "Anywhere"); assert.equal(first.employmentType, "Full Time");
  assert.equal(first.description, "Build & test List<T>.\nDevelop Linux systems\nSupport customers");
  assert.equal(first.postedAt?.toISOString(), "2026-10-04T05:45:40.000Z");
  assert.equal(first.url, "https://example.test/jobs/solutions-architect");
  assert.equal(first.sourceUrl, first.url); assert.equal(first.canonicalUrl, first.url);
  assert.equal(first.externalId, first.url); assert.equal(sourceIdentity(first), `id:${first.url}`);
  assert.equal(first.raw?.["job_listing:category"], "Software Engineering");
  assert.equal(first.raw?.["job_listing:company"], "Example Company");
  assert.equal(first.salary, null); assert.equal(first.sourceUpdatedAt, null); assert.equal(first.observedAt, at);
  assert.equal(first.availability, "unknown");
  const second = normalizeRssItem(items[1], feed, at)!;
  assert.equal(second.company, "Example Company"); assert.equal(second.location, "USA, Canada, LATAM");
  assert.equal(second.description, "Lead the direct sales team.");
});

test("explicit company takes precedence over title parsing and malformed or missing metadata is not invented", () => {
  const feed = { source: "jobicy" as const, url: "https://example.test/jobicy-feed" }, at = new Date();
  const base = { title: "Engineer - Platform", link: "https://example.test/job", "job_listing:company": " Actual Co ",
    "job_listing:location": "Canada", "job_listing:job_type": "Contract" };
  const job = normalizeRssItem(base, feed, at)!;
  assert.equal(job.title, base.title); assert.equal(job.company, "Actual Co");
  const missing = normalizeRssItem({ title: "Engineer", link: base.link, "job_listing:company": {},
    "job_listing:location": ["Canada"], "job_listing:job_type": " " }, feed, at)!;
  assert.equal(missing.company, "Unknown", "the existing required-string fallback is retained");
  assert.equal(missing.location, null); assert.equal(missing.employmentType, null);
});

test("generic RSS retains title/company fallbacks, explicit metadata, GUIDs and original descriptions without Jobicy assumptions", () => {
  const at = new Date(), feed = { source: "indeed_rss" as const, url: "https://example.test/feed" };
  for (const title of ["Engineer at Example", "Engineer - Example"]) {
    const job = normalizeRssItem({ title, link: "https://example.test/job", guid: "opaque", description: "Original description" }, feed, at)!;
    assert.equal(job.title, "Engineer"); assert.equal(job.company, "Example"); assert.equal(job.location, null);
    assert.equal(job.externalId, "opaque"); assert.equal(job.description, "Original description");
  }
  const explicit = normalizeRssItem({ title: "Engineer - Platform", company: "Real Co", location: "Toronto", employmentType: "Part-time",
    link: "https://example.test/job", "job_listing:company": "Ignore provider field", "content:encoded": "Ignore provider content" }, feed, at)!;
  assert.equal(explicit.company, "Real Co"); assert.equal(explicit.title, "Engineer - Platform"); assert.equal(explicit.location, "Toronto");
  assert.equal(explicit.employmentType, "Part-time"); assert.equal(explicit.description, "");
});

test("Jobicy is explicitly opt-in operator RSS configuration", () => {
  assert(!configuredFeeds({}).some(feed=>feed.source === "jobicy"));
  const feeds=configuredFeeds({JOBICY_RSS_URL:"https://example.test/jobicy"});
  assert.equal(feeds.find(feed=>feed.source === "jobicy")!.url,"https://example.test/jobicy");
});
