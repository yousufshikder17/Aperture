import assert from "node:assert/strict";
import test from "node:test";
import { CompanyRegistrySchema, LeverSourceSchema, type LeverSource } from "@aperture/shared";
import { CareerFetchError, type CareerReader } from "../src/services/career-http.js";
import { LeverJobSourceAdapter, leverEndpoint, normalizeLeverJob } from "../src/services/lever-source.js";
import type { JobSourceConfig } from "../src/services/job-source.js";
import { providerNamespace } from "../src/services/normalized-job.js";

const at = new Date("2026-10-04T12:00:00Z");
const source = LeverSourceSchema.parse({ provider: "lever", id: "example-lever", companyId: "example", site: "example",
  enabled: true, intervalHours: 24, support: "supported" });
const registry = CompanyRegistrySchema.parse({ companies: [{ id: "example", slug: "example", name: "Example Co",
  careersUrl: "https://example.test/careers", enabled: true, tags: [] }], sources: [source] });
const config: JobSourceConfig<LeverSource> = { provider: "lever", sourceId: source.id, source: "career_page", enabled: true, config: source };
const job = { id: "posting-123", text: "Engineer", hostedUrl: "https://jobs.lever.co/example/posting-123",
  applyUrl: "https://jobs.lever.co/example/posting-123/apply", categories: { location: "Toronto", commitment: "Full-time",
    team: "Engineering", department: "Product", allLocations: ["Toronto", "Ottawa"] }, country: "CA", workplaceType: "hybrid",
  description: "<p>Build &amp; test List&lt;T&gt;.</p><p>Collaborate.</p><script>bad()</script>",
  opening: "<p>Already in description; omit me.</p>", descriptionBody: "<p>Already in description; omit me.</p>",
  lists: [{ text: "Responsibilities", content: "<ul><li>Ship <a href='javascript:bad()'>safely</a></li><li>Review code</li></ul>" }],
  salaryRange: { currency: "USD", interval: "year", min: 120000, max: 180000 },
  salaryDescription: "<p>Plus equity</p>", additional: "<p>Apply today.</p>" };
function reader(pages: unknown[], options: { failAt?: number; error?: Error; contentType?: string; raw?: boolean } = {}) {
  const calls: string[] = [];
  const read: CareerReader = async (target, url = target.url, context) => {
    context.signal?.throwIfAborted(); calls.push(url);
    assert.equal(target.expectedHostname, new URL(url).hostname); assert.deepEqual(target.redirectHosts, []);
    if (calls.length === options.failAt) throw options.error ?? new Error("private network detail");
    assert(calls.length <= pages.length, "unexpected extra page request");
    return { url, body: options.raw ? String(pages[calls.length - 1]) : JSON.stringify(pages[calls.length - 1]),
      contentType: options.contentType ?? "application/json", redirects: [] };
  };
  return { calls, adapter: new LeverJobSourceAdapter(registry, read) };
}

test("Lever constructs fixed public HTTPS endpoints with explicit JSON and pagination, including EU", () => {
  assert.equal(leverEndpoint("example"), "https://api.lever.co/v0/postings/example?mode=json&skip=0&limit=100");
  assert.equal(leverEndpoint("example", "eu", 100), "https://api.eu.lever.co/v0/postings/example?mode=json&skip=100&limit=100");
  assert.equal(new URL(leverEndpoint("../other?mode=html")).searchParams.get("mode"), "json");
});

test("multiple published jobs normalize documented fields and consume the terminal empty page", async () => {
  const second = { ...job, id: "posting-456", text: "Designer", hostedUrl: "https://jobs.lever.co/example/posting-456",
    applyUrl: "https://jobs.lever.co/example/posting-456/apply" };
  const { adapter, calls } = reader([[job, second], []]);
  const result = await adapter.fetch(config, { now: () => at });
  assert.equal(result.status, "success"); assert.equal(result.snapshotComplete, true);
  assert.equal(result.recordsReceived, 2); assert.equal(result.jobs.length, 2);
  assert.deepEqual(calls, [leverEndpoint("example"), leverEndpoint("example", "global", 2)]);
  assert.equal(result.snapshotNamespace, "lever:global%2Fexample");
  const first = result.jobs[0]!;
  assert.equal(first.externalId, job.id); assert.equal(first.namespace, result.snapshotNamespace);
  assert.equal(first.title, job.text); assert.equal(first.company, "Example Co"); assert.equal(first.location, "Toronto");
  assert.equal(first.employmentType, "Full-time"); assert.equal(first.salary, "USD 120000–180000 / year");
  assert.equal(first.url, job.hostedUrl); assert.equal(first.sourceUrl, job.hostedUrl); assert.equal(first.canonicalUrl, job.hostedUrl);
  assert.equal(first.applicationUrl, job.applyUrl); assert.equal(first.observedAt, at); assert.equal(first.availability, "open");
  assert.equal(first.description, "Build & test List<T>.\nCollaborate.\n\nResponsibilities\nShip safely\nReview code\n\nPlus equity\n\nApply today.");
  assert.deepEqual(first.raw, { id: job.id, categories: job.categories, country: "CA", workplaceType: "hybrid", salaryRange: job.salaryRange });
  assert.equal(first.postedAt, null); assert.equal(first.sourceUpdatedAt, null);
  assert(!JSON.stringify(first.raw).includes("<script>"));
});

test("valid empty site is complete and sparse optional fields remain absent", async () => {
  const result = await reader([[]]).adapter.fetch(config, { now: () => at });
  assert.equal(result.status, "success"); assert.equal(result.snapshotComplete, true);
  assert.equal(result.snapshotNamespace, "lever:global%2Fexample"); assert.deepEqual(result.jobs, []);
  const sparse = normalizeLeverJob({ id: job.id, text: job.text, hostedUrl: job.hostedUrl }, config, "Example Co", at)!;
  assert.equal(sparse.description, ""); assert.equal(sparse.location, null); assert.equal(sparse.salary, null);
  assert.equal(sparse.employmentType, null); assert.equal(sparse.applicationUrl, undefined);
  assert.equal(sparse.postedAt, null); assert.equal(sparse.sourceUpdatedAt, null);
});

test("pagination consumes short pages by actual count and never assumes a short page is complete", async () => {
  const next = { ...job, id: "second", hostedUrl: "https://jobs.lever.co/example/second", applyUrl: null };
  const { adapter, calls } = reader([[job], [next], []]);
  const result = await adapter.fetch(config);
  assert.equal(result.snapshotComplete, true); assert.equal(result.jobs.length, 2);
  assert.deepEqual(calls.map(url => new URL(url).searchParams.get("skip")), ["0", "1", "2"]);
});

test("malformed top-level responses and a later page failure cannot authorize closure", async () => {
  for (const payload of ["{", "{}", '{"jobs":[]}', "null", '"postings"']) {
    const result = await reader([payload], { raw: true }).adapter.fetch(config);
    assert.equal(result.status, "failure"); assert.equal(result.snapshotComplete, false);
    assert.equal(result.error?.kind, "payload"); assert.equal(result.error?.retryable, false);
  }
  const { adapter, calls } = reader([[job], []], { failAt: 2 });
  const failed = await adapter.fetch(config);
  assert.equal(calls.length, 2); assert.equal(failed.status, "failure"); assert.equal(failed.snapshotComplete, false);
  assert.deepEqual(failed.jobs, []); assert.equal(failed.recordsReceived, 1); assert.equal(failed.error?.retryable, true);
  assert(!JSON.stringify(failed).includes("private network detail"));
});

test("malformed individual postings and invalid optional metadata produce structured partial scans", async () => {
  for (const invalid of [null, { ...job, id: 123 }, { ...job, text: "" }, { ...job, id: "bad", workplaceType: "invented" },
    { ...job, id: "bad", salaryRange: { min: 5, max: 1 } }]) {
    const result = await reader([[job, invalid], []]).adapter.fetch(config);
    assert.equal(result.status, "partial"); assert.equal(result.snapshotComplete, false);
    assert(result.warnings.some(warning => warning.code === "invalid_record"));
    assert.equal(result.jobs.length, invalid && typeof invalid === "object" && "id" in invalid && invalid.id === job.id ? 0 : 1);
  }
});

test("duplicate and conflicting IDs across pages are withheld and cannot authorize closure", async () => {
  for (const duplicate of [job, { ...job, text: "Different role" }, { id: job.id, text: null }]) {
    const result = await reader([[job], [duplicate], []]).adapter.fetch(config);
    assert.equal(result.status, "partial"); assert.equal(result.snapshotComplete, false); assert.deepEqual(result.jobs, []);
    assert(result.warnings.some(warning => warning.code === "duplicate_job_id"));
    assert.equal(result.warnings.some(warning => warning.code === "conflicting_job_id"), duplicate !== job);
  }
});

test("site, region and provider namespace scopes isolate IDs while title and location changes preserve identity", () => {
  const first = normalizeLeverJob(job, config, "Example Co", at)!;
  const changed = normalizeLeverJob({ ...job, text: "Senior Engineer", categories: { ...job.categories, location: "Ottawa" } }, config, "Example Co", at)!;
  assert.equal(first.externalId, changed.externalId); assert.equal(first.namespace, changed.namespace);
  const otherConfig = { ...config, config: { ...source, site: "other" } };
  const other = normalizeLeverJob({ ...job, hostedUrl: job.hostedUrl.replace("/example/", "/other/"),
    applyUrl: job.applyUrl.replace("/example/", "/other/") }, otherConfig, "Other Co", at)!;
  const euConfig = { ...config, config: { ...source, region: "eu" as const } };
  const eu = normalizeLeverJob({ ...job, hostedUrl: job.hostedUrl.replace("jobs.lever.co", "jobs.eu.lever.co"),
    applyUrl: job.applyUrl.replace("jobs.lever.co", "jobs.eu.lever.co") }, euConfig, "Example Co", at)!;
  assert.notEqual(first.namespace, other.namespace); assert.notEqual(first.namespace, eu.namespace);
  assert.notEqual(first.namespace, providerNamespace("greenhouse", "global/example"));
  assert.equal(normalizeLeverJob({ ...job, hostedUrl: "https://jobs.lever.co/legacy/posting-123",
    applyUrl: null }, { ...config, config: { ...source, site: "legacy" } }, "Example", at)!.namespace, "lever:global%2Flegacy");
});

test("unsafe, credentialed, unrelated, wrong-site and wrong-post URLs are rejected", async () => {
  for (const hostedUrl of ["http://jobs.lever.co/example/posting-123", "javascript:bad()", "https://user:secret@jobs.lever.co/example/posting-123",
    "https://evil.test/example/posting-123", "https://jobs.lever.co/other/posting-123", "https://jobs.lever.co/example/other"]) {
    const result = await reader([[{ ...job, hostedUrl }], []]).adapter.fetch(config);
    assert.equal(result.status, "partial"); assert.equal(result.snapshotComplete, false); assert.deepEqual(result.jobs, []);
  }
  assert.equal(normalizeLeverJob({ ...job, applyUrl: "https://jobs.lever.co/example/other/apply" }, config, "Example", at), null);
  assert.equal(normalizeLeverJob({ ...job, applyUrl: "https://jobs.lever.co/example/posting-123/apply?source=careers" }, config, "Example", at)!.applicationUrl,
    "https://jobs.lever.co/example/posting-123/apply?source=careers");
});

test("plaintext, opening/body fallbacks, lists and encoded examples are sanitized exactly once", () => {
  const plain = normalizeLeverJob({ id: job.id, text: job.text, hostedUrl: job.hostedUrl,
    descriptionPlain: "Use List<T> and <script> as examples.", additionalPlain: "Plain & useful" }, config, "Example", at)!;
  assert.equal(plain.description, "Use List<T> and <script> as examples.\nPlain & useful");
  const fallback = normalizeLeverJob({ id: job.id, text: job.text, hostedUrl: job.hostedUrl, opening: "<p>Intro</p>",
    descriptionBody: "<p>Use List&lt;T&gt;.</p><style>bad()</style>", lists: [{ text: "<Requirements>", content: "<ul><li>One</li></ul>" }] }, config, "Example", at)!;
  assert.equal(fallback.description, "Intro\n\nUse List<T>.\n\n<Requirements>\nOne");
});

test("salary and commitment use provider evidence, timestamps with undocumented units remain raw", () => {
  const normalized = normalizeLeverJob({ ...job, salaryRange: { currency: "CAD", interval: "hour", min: 50, max: 50 },
    categories: { commitment: "Contract", allLocations: ["Toronto", "Ottawa"] }, createdAt: 1700000000000, updatedAt: "2026-10-01" }, config, "Example", at)!;
  assert.equal(normalized.salary, "CAD 50 / hour"); assert.equal(normalized.employmentType, "Contract");
  assert.equal(normalized.location, "Toronto; Ottawa"); assert.equal(normalized.postedAt, null); assert.equal(normalized.sourceUpdatedAt, null);
  assert.equal(normalized.raw?.createdAt, 1700000000000); assert.equal(normalized.raw?.updatedAt, "2026-10-01");
  assert.equal(normalizeLeverJob({ ...job, salaryRange: { min: 100 }, categories: {} }, config, "Example", at)!.salary, null);
});

test("official demo's onsite spelling is retained as raw metadata and does not reject valid postings", async () => {
  const result = await reader([[{ ...job, workplaceType: "onsite", salaryRange: { currency: "USD", interval: "per-year-salary", min: 150000, max: 185000 },
    createdAt: 1700000000000 }], []]).adapter.fetch(config, { now: () => at });
  assert.equal(result.status, "success"); assert.equal(result.snapshotComplete, true);
  assert.equal(result.jobs[0]!.raw?.workplaceType, "onsite");
  assert.equal(result.jobs[0]!.raw?.createdAt, 1700000000000);
  assert.equal(result.jobs[0]!.salary, "USD 150000–185000 / per-year-salary");
});

test("configuration, source failure, cancellation and scan timeout are bounded and structured without adapter retries", async () => {
  const { adapter, calls } = reader([[]], { failAt: 1, error: new CareerFetchError("source", "rate_limited", true) });
  for (const invalid of [{ ...config, enabled: false }, { ...config, provider: "other" }, { ...config, config: { ...source, site: "../other" } },
    { ...config, config: { ...source, site: "unapproved" } }]) {
    assert.equal((await adapter.fetch(invalid)).error?.kind, "configuration");
  }
  assert.equal(calls.length, 0);
  assert.equal((await adapter.fetch(config)).error?.retryable, true); assert.equal(calls.length, 1);
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal((await reader([[]]).adapter.fetch(config, { signal: cancelled.signal })).error?.retryable, false);
  const timeout = new LeverJobSourceAdapter(registry, async (_target, _url, context) => {
    await new Promise<void>((resolve) => setTimeout(resolve, 10)); context.signal?.throwIfAborted();
    return { url: leverEndpoint(source.site), contentType: "application/json", body: "[]", redirects: [] };
  });
  assert.equal((await timeout.fetch(config, { timeoutMs: 1 })).error?.code, "request_timeout");
  assert.equal((await reader([[]], { contentType: "text/html" }).adapter.fetch(config)).error?.code, "unexpected_content_type");
});

test("pagination and size bounds cannot be misrepresented as complete snapshots", async () => {
  const repeated = reader(Array.from({ length: 100 }, () => [job]));
  const limited = await repeated.adapter.fetch(config);
  assert.equal(repeated.calls.length, 100); assert.equal(limited.status, "partial"); assert.equal(limited.snapshotComplete, false);
  assert(limited.warnings.some(warning => warning.code === "pagination_limit"));
  const oversizePage = await reader([Array.from({ length: 101 }, () => job)]).adapter.fetch(config);
  assert.equal(oversizePage.status, "failure"); assert.equal(oversizePage.snapshotComplete, false);
  const oversized = reader([[{ ...job, description: "x".repeat(9 * 1024 * 1024) }], [{ ...job, description: "x".repeat(9 * 1024 * 1024) }]]);
  assert.equal((await oversized.adapter.fetch(config)).error?.code, "scan_too_large");
});
