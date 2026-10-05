import assert from "node:assert/strict";
import test from "node:test";
import { AshbySourceSchema, CompanyRegistrySchema, type AshbySource } from "@aperture/shared";
import { AshbyJobSourceAdapter, ashbyEndpoint, normalizeAshbyJob } from "../src/services/ashby-source.js";
import { CareerFetchError, type CareerReader } from "../src/services/career-http.js";
import type { JobSourceConfig } from "../src/services/job-source.js";
import { providerNamespace, sourceIdentity } from "../src/services/normalized-job.js";

const at = new Date("2026-10-04T12:00:00Z");
const source = AshbySourceSchema.parse({ provider: "ashby", id: "example-ashby", companyId: "example", boardName: "Example",
  enabled: true, intervalHours: 24, support: "supported" });
const registry = CompanyRegistrySchema.parse({ companies: [{ id: "example", slug: "example", name: "Example Co",
  careersUrl: "https://example.test/careers", enabled: true, tags: [] }], sources: [source] });
const config: JobSourceConfig<AshbySource> = { provider: "ashby", sourceId: source.id, source: "career_page", enabled: true, config: source };
const compensation = { compensationTierSummary: "$120K–$180K + equity + bonus",
  summaryComponents: [{ compensationType: "Salary", currencyCode: "USD", interval: "1 YEAR", minValue: 120000, maxValue: 180000 },
    { compensationType: "EquityPercentage", currencyCode: null, interval: "NONE", minValue: 0.5, maxValue: 1.5 },
    { compensationType: "Bonus", currencyCode: "USD", interval: "1 YEAR", minValue: null, maxValue: null }],
  compensationTiers: [{ id: "zone-a", title: "Zone A", components: [{ compensationType: "Salary", currencyCode: "USD",
    interval: "1 YEAR", minValue: 120000, maxValue: 180000 }] }] };
const job = { title: "Engineer", jobUrl: "https://jobs.ashbyhq.com/Example/job-123",
  applyUrl: "https://jobs.ashbyhq.com/Example/job-123/application", isListed: true, location: "Toronto",
  secondaryLocations: [{ location: "Ottawa", address: { addressLocality: "Ottawa", addressCountry: "CA" } }],
  address: { postalAddress: { addressLocality: "Toronto", addressCountry: "CA" } }, department: "Engineering", team: "Platform",
  isRemote: true, workplaceType: "Hybrid", employmentType: "FullTime", publishedAt: "2026-10-01T12:00:00Z",
  descriptionHtml: "<p>Build &amp; test List&lt;T&gt;.</p><ul><li>Ship <a href='javascript:bad()'>safely</a></li></ul><script>bad()</script><style>bad</style>",
  descriptionPlain: "Unused fallback", compensation };
function fixture(jobs: unknown[]) { return { apiVersion: "1", jobs }; }
function reader(payload: unknown = fixture([job]), options: { error?: Error; raw?: boolean; contentType?: string } = {}) {
  const calls: string[] = [];
  const read: CareerReader = async (target, url = target.url, context) => {
    assert.equal(target.expectedHostname, "api.ashbyhq.com"); assert.deepEqual(target.redirectHosts, []);
    context.signal?.throwIfAborted(); calls.push(url);
    if (options.error) throw options.error;
    return { url, body: options.raw ? String(payload) : JSON.stringify(payload),
      contentType: options.contentType ?? "application/json", redirects: [] };
  };
  return { adapter: new AshbyJobSourceAdapter(registry, read), calls };
}

test("Ashby constructs a fixed public HTTPS destination and normalizes multiple listed postings", async () => {
  const other = { ...job, title: "Designer", jobUrl: job.jobUrl.replace("job-123", "job-456"), applyUrl: null };
  const { adapter, calls } = reader(fixture([job, other]));
  const result = await adapter.fetch(config, { now: () => at });
  assert.deepEqual(calls, ["https://api.ashbyhq.com/posting-api/job-board/Example?includeCompensation=true"]);
  assert.equal(result.status, "success"); assert.equal(result.snapshotComplete, true);
  assert.equal(result.snapshotNamespace, "ashby:Example"); assert.equal(result.recordsReceived, 2); assert.equal(result.jobs.length, 2);
  const first = result.jobs[0]!;
  assert.equal(first.externalId, null); assert.equal(sourceIdentity(first), `url:${job.jobUrl}`);
  assert.equal(first.title, job.title); assert.equal(first.company, "Example Co"); assert.equal(first.location, "Toronto");
  assert.equal(first.url, job.jobUrl); assert.equal(first.sourceUrl, job.jobUrl); assert.equal(first.canonicalUrl, job.jobUrl);
  assert.equal(first.applicationUrl, job.applyUrl); assert.equal(first.observedAt, at); assert.equal(first.availability, "open");
  assert.equal(first.description, "Build & test List<T>.\nShip safely"); assert.equal(first.employmentType, "FullTime");
  assert.equal(first.salary, "USD 120000–180000 / year"); assert.equal(first.postedAt?.toISOString(), job.publishedAt.replace("Z", ".000Z"));
  assert.equal(first.sourceUpdatedAt, null); assert.deepEqual(first.raw?.compensation, compensation);
  for (const key of ["secondaryLocations", "department", "team", "isRemote", "workplaceType", "address", "isListed"] as const)
    assert.deepEqual(first.raw?.[key], job[key]);
  assert(!JSON.stringify(first.raw).includes("<script>"));
  assert.equal(new URL(ashbyEndpoint("../other?x=1")).search, "?includeCompensation=true");
});

test("valid empty boards and sparse postings have complete scoped snapshots with no invented metadata", async () => {
  const empty = await reader(fixture([])).adapter.fetch(config);
  assert.equal(empty.snapshotComplete, true); assert.equal(empty.snapshotNamespace, "ashby:Example"); assert.deepEqual(empty.jobs, []);
  const sparse = await reader(fixture([{ title: job.title, jobUrl: job.jobUrl, isListed: true }])).adapter.fetch(config);
  assert.equal(sparse.snapshotComplete, true);
  const value = sparse.jobs[0]!;
  assert.equal(value.location, null); assert.equal(value.description, ""); assert.equal(value.salary, null);
  assert.equal(value.employmentType, null); assert.equal(value.applicationUrl, undefined);
  assert.equal(value.postedAt, null); assert.equal(value.sourceUpdatedAt, null);
});

test("unlisted direct-link-only jobs are excluded, including complete boards containing only unlisted jobs", async () => {
  const hidden = { ...job, isListed: false, jobUrl: job.jobUrl.replace("job-123", "hidden"), applyUrl: null };
  const mixed = await reader(fixture([job, hidden])).adapter.fetch(config);
  assert.equal(mixed.snapshotComplete, true); assert.equal(mixed.recordsReceived, 2); assert.equal(mixed.jobs.length, 1);
  const unlisted = await reader(fixture([hidden])).adapter.fetch(config);
  assert.equal(unlisted.snapshotComplete, true); assert.deepEqual(unlisted.jobs, []);
  for (const isListed of [undefined, null, "true", 1]) {
    const result = await reader(fixture([{ ...job, isListed }])).adapter.fetch(config);
    assert.equal(result.status, "partial"); assert.equal(result.snapshotComplete, false); assert.deepEqual(result.jobs, []);
  }
});

test("malformed top-level payloads, unknown API versions and wrong content types cannot authorize closure", async () => {
  for (const value of [null, [], {}, { jobs: [] }, { apiVersion: "2", jobs: [] }, { apiVersion: "1", jobs: null }]) {
    const result = await reader(value).adapter.fetch(config);
    assert.equal(result.status, "failure"); assert.equal(result.snapshotComplete, false);
    assert.equal(result.error?.kind, "payload"); assert.equal(result.error?.retryable, false);
  }
  assert.equal((await reader("{", { raw: true }).adapter.fetch(config)).error?.code, "malformed_json");
  assert.equal((await reader(fixture([]), { contentType: "text/html" }).adapter.fetch(config)).error?.code, "unexpected_content_type");
});

test("one malformed job keeps other valid jobs but prevents authoritative closure, even for malformed unlisted records", async () => {
  for (const invalid of [null, { title: "Bad", jobUrl: "bad", isListed: true }, { ...job, title: "", isListed: false },
    { ...job, jobUrl: job.jobUrl.replace("job-123", "bad"), isRemote: "false" }]) {
    const result = await reader(fixture([job, invalid])).adapter.fetch(config);
    assert.equal(result.status, "partial"); assert.equal(result.snapshotComplete, false);
    assert(result.warnings.some(warning => warning.code === "invalid_record"));
    assert.equal(result.jobs.length, invalid && typeof invalid === "object" && "jobUrl" in invalid && invalid.jobUrl === job.jobUrl ? 0 : 1);
  }
});

test("identical, conflicting and mixed-visibility duplicate URL identities are withheld and downgrade completeness", async () => {
  for (const duplicate of [job, { ...job, title: "Different" }, { ...job, isListed: false }, { jobUrl: job.jobUrl }]) {
    const result = await reader(fixture([job, duplicate])).adapter.fetch(config);
    assert.equal(result.status, "partial"); assert.equal(result.snapshotComplete, false); assert.deepEqual(result.jobs, []);
    assert(result.warnings.some(warning => warning.code === "duplicate_job_identity"));
    assert.equal(result.warnings.some(warning => warning.code === "conflicting_job_identity"), duplicate !== job);
  }
});

test("documented job URLs preserve identity across all content changes and namespaces isolate boards and providers", () => {
  const first = normalizeAshbyJob(job, config, "Example Co", at)!;
  const changed = normalizeAshbyJob({ ...job, title: "Senior", location: "Ottawa", descriptionHtml: "<p>Changed</p>",
    compensation: null }, config, "Example Co", at)!;
  assert.equal(sourceIdentity(first), sourceIdentity(changed)); assert.equal(first.namespace, changed.namespace);
  for (const boardName of ["Other", "legacy"]) {
    const other = normalizeAshbyJob({ ...job, jobUrl: job.jobUrl.replace("/Example/", `/${boardName}/`), applyUrl: null },
      { ...config, config: { ...source, boardName } }, "Example Co", at)!;
    assert.notEqual(other.namespace, first.namespace); assert.notEqual(other.namespace, "legacy");
  }
  for (const provider of ["greenhouse", "lever", "direct-career-site"])
    assert.notEqual(first.namespace, providerNamespace(provider, "Example"));
  const withId = normalizeAshbyJob({ ...job, id: "undocumented-id" }, config, "Example Co", at)!;
  assert.equal(withId.externalId, null, "an undocumented payload id is not an identity contract");
  assert.equal(withId.raw?.id, "undocumented-id");
});

test("URLs reject unsafe, credentialed, wrong-board and unrelated destinations and retain application query parameters", async () => {
  for (const jobUrl of ["http://jobs.ashbyhq.com/Example/job-123", "javascript:bad()", "https://secret@jobs.ashbyhq.com/Example/job-123",
    "https://evil.test/Example/job-123", "https://jobs.ashbyhq.com/Other/job-123", `${job.jobUrl}?alias=another`, `${job.jobUrl}#fragment`]) {
    const result = await reader(fixture([{ ...job, jobUrl }])).adapter.fetch(config);
    assert.equal(result.snapshotComplete, false); assert.deepEqual(result.jobs, []);
  }
  for (const applyUrl of ["http://jobs.ashbyhq.com/Example/job-123/application", "https://evil.test/apply", job.applyUrl.replace("job-123", "other"),
    "https://secret@jobs.ashbyhq.com/Example/job-123/application"]) assert.equal(normalizeAshbyJob({ ...job, applyUrl }, config, "Example", at), null);
  const applyUrl = `${job.applyUrl}?utm_source=careers`;
  assert.equal(normalizeAshbyJob({ ...job, applyUrl }, config, "Example", at)!.applicationUrl, applyUrl);
});

test("HTML is sanitized once and plaintext code is escaped before shared normalization", () => {
  const plain = normalizeAshbyJob({ ...job, descriptionHtml: null, descriptionPlain: "Use List<T> & <script> as examples" }, config, "Example", at)!;
  assert.equal(plain.description, "Use List<T> & <script> as examples");
  assert.equal(normalizeAshbyJob({ ...job, descriptionHtml: "<div><p>A</p><ul><li>B &amp; C</li></ul><template>bad</template><img onerror='bad()'></div>" },
    config, "Example", at)!.description, "A\nB & C");
});

test("documented employment/workplace enums and safe future metadata are retained without inventing remote locations", async () => {
  for (const employmentType of ["FullTime", "PartTime", "Intern", "Contract", "Temporary"])
    assert.equal(normalizeAshbyJob({ ...job, employmentType }, config, "Example", at)!.employmentType, employmentType);
  for (const workplaceType of ["OnSite", "Remote", "Hybrid", "FutureType"]) {
    const result = await reader(fixture([{ ...job, workplaceType, employmentType: "FutureType", location: null }])).adapter.fetch(config);
    assert.equal(result.snapshotComplete, true); assert.equal(result.jobs[0]!.raw?.workplaceType, workplaceType);
    assert.equal(result.jobs[0]!.raw?.employmentType, "FutureType"); assert.equal(result.jobs[0]!.employmentType, null);
    assert.equal(result.jobs[0]!.location, null); assert.equal(result.jobs[0]!.raw?.isRemote, true);
  }
});

test("publication dates use postedAt, missing/invalid dates never become sourceUpdatedAt", async () => {
  for (const publishedAt of [null, undefined, "", "not-a-date"]) {
    const result = await reader(fixture([{ ...job, publishedAt }])).adapter.fetch(config);
    assert.equal(result.jobs[0]!.postedAt, null); assert.equal(result.jobs[0]!.sourceUpdatedAt, null);
    assert.equal(result.snapshotComplete, publishedAt !== "not-a-date");
    if (publishedAt === "not-a-date") assert.deepEqual(result.warnings, [{ code: "invalid_published_at", count: 1 }]);
  }
});

test("only representable salary components map; tiers, bonuses, equity and unknown intervals remain raw", () => {
  const base = compensation.summaryComponents[0]!;
  for (const change of [{ currencyCode: null }, { minValue: null }, { maxValue: null }, { minValue: -1 }, { minValue: 200000 },
    { interval: "NONE" }, { interval: "UNKNOWN" }, { currencyCode: "unknown" }, { currencyCode: "ZZZ" }]) {
    const value = { ...compensation, summaryComponents: [{ ...base, ...change }] };
    const normalized = normalizeAshbyJob({ ...job, compensation: value }, config, "Example", at)!;
    assert.equal(normalized.salary, null); assert.deepEqual(normalized.raw?.compensation, value);
  }
  assert.equal(normalizeAshbyJob({ ...job, compensation: { ...compensation, summaryComponents: [base, base] } }, config, "Example", at)!.salary, null);
  assert.equal(normalizeAshbyJob({ ...job, compensation: { compensationTiers: compensation.compensationTiers } }, config, "Example", at)!.salary, null);
  assert.equal(normalizeAshbyJob({ ...job, compensation: { summaryComponents: [{ ...base, interval: "1 HOUR", minValue: 50, maxValue: 50 }] } },
    config, "Example", at)!.salary, "USD 50 / hour");
});

test("configuration approval, disabled sources, timeouts, network failures and cancellation use generic failures without retries", async () => {
  for (const changed of [{ ...config, enabled: false }, { ...config, sourceId: "wrong" }, { ...config, provider: "other" },
    { ...config, config: { ...source, boardName: "../evil" } }, { ...config, config: { ...source, boardName: "Other" } }]) {
    const { adapter, calls } = reader(); const result = await adapter.fetch(changed);
    assert.equal(result.error?.kind, "configuration"); assert.equal(result.error?.retryable, false); assert.deepEqual(calls, []);
  }
  assert.equal((await reader().adapter.fetch(config, { timeoutMs: 0 })).error?.kind, "configuration");
  for (const error of [new Error("secret network detail"), new CareerFetchError("source", "http_404", false), new CareerFetchError("source", "rate_limited", true),
    new CareerFetchError("payload", "response_too_large", false)]) {
    const { adapter, calls } = reader(undefined, { error }); const result = await adapter.fetch(config);
    assert.equal(result.status, "failure"); assert.equal(result.snapshotComplete, false); assert.deepEqual(result.jobs, []); assert.equal(calls.length, 1);
    assert.equal(result.error?.retryable, error instanceof CareerFetchError ? error.retryable : true);
    assert(!JSON.stringify(result).includes("secret network detail"));
  }
  const signal = AbortSignal.abort(); const result = await reader().adapter.fetch(config, { signal });
  assert.equal(result.error?.code, "request_cancelled"); assert.equal(result.error?.retryable, false);
});
