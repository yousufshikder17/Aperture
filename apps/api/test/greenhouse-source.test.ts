import assert from "node:assert/strict";
import test from "node:test";
import { CompanyRegistrySchema } from "@aperture/shared";
import { companyRegistry } from "../src/services/company-registry.js";
import { CareerFetchError } from "../src/services/career-http.js";
import { GreenhouseJobSourceAdapter, greenhouseEndpoint, normalizeGreenhouseJob } from "../src/services/greenhouse-source.js";
import { providerNamespace } from "../src/services/normalized-job.js";

const at = new Date("2026-10-01T12:00:00.000Z");
const source = { provider: "greenhouse", id: "example-greenhouse", companyId: "example", boardToken: "example-board", enabled: true,
  intervalHours: 24, support: "supported" as const };
const registry = CompanyRegistrySchema.parse({ companies: [{ id: "example", slug: "example", name: "Example Co",
  careersUrl: "https://example.test/careers", enabled: true, tags: [] }], sources: [source] });
const config = { provider: "greenhouse", sourceId: source.id, source: "career_page" as const, enabled: true, config: source };
const job = { id: 123, title: "Engineer", absolute_url: "https://boards.greenhouse.io/example/jobs/123",
  updated_at: "2026-09-30T11:12:13Z", content: "&amp;lt;p&amp;gt;Build &amp;amp; test&amp;lt;/p&amp;gt;<ul><li>Ship safely</li></ul><script>bad()</script>",
  location: { name: "Toronto" }, departments: [{ id: 1, name: "Engineering" }], offices: [{ id: 2, name: "Toronto" }] };
const payload = (jobs: unknown[], total = jobs.length) => JSON.stringify({ jobs, meta: { total } });
function adapter(body: string, options: { contentType?: string; error?: Error } = {}) {
  const calls: string[] = [];
  const instance = new GreenhouseJobSourceAdapter(registry, async (_source, url, context) => {
    calls.push(url); context.signal?.throwIfAborted();
    if (options.error) throw options.error;
    return { url, body, contentType: options.contentType ?? "application/json", redirects: [] };
  });
  return { instance, calls };
}

test("Greenhouse endpoint is fixed to the official HTTPS board API and requests content", () => {
  assert.equal(greenhouseEndpoint("example-board"),
    "https://boards-api.greenhouse.io/v1/boards/example-board/jobs?content=true");
  assert.equal(greenhouseEndpoint("company name"), "https://boards-api.greenhouse.io/v1/boards/company%20name/jobs?content=true");
});

test("normalizes public job fields, safe description text and provider metadata", async () => {
  const { instance, calls } = adapter(payload([job]));
  const result = await instance.fetch(config, { now: () => at });
  assert.deepEqual(calls, [greenhouseEndpoint("example-board")]);
  assert.equal(result.status, "success"); assert.equal(result.snapshotComplete, true);
  assert.equal(result.recordsReceived, 1);
  assert.equal(result.snapshotNamespace, "greenhouse:example-board");
  const normalized = result.jobs[0]!;
  assert.equal(normalized.source, "career_page"); assert.equal(normalized.namespace, "greenhouse:example-board");
  assert.equal(normalized.externalId, "123"); assert.equal(normalized.title, "Engineer");
  assert.equal(normalized.company, "Example Co"); assert.equal(normalized.location, "Toronto");
  assert.equal(normalized.description, "Build & test\nShip safely");
  assert.equal(normalized.sourceUpdatedAt?.toISOString(), "2026-09-30T11:12:13.000Z");
  assert.equal(normalized.observedAt, at); assert.equal(normalized.availability, "open");
  assert.equal(normalized.url, job.absolute_url); assert.equal(normalized.sourceUrl, job.absolute_url);
  assert.equal(normalized.canonicalUrl, job.absolute_url); assert.equal(normalized.applicationUrl, job.absolute_url);
  assert.deepEqual(normalized.raw, { id: 123, updated_at: job.updated_at, departments: job.departments, offices: job.offices });
  assert(!normalized.description.includes("bad")); assert(!JSON.stringify(normalized.raw).includes("<script>"));
});

test("a valid empty complete board is authoritative, while missing optional fields stay missing", async () => {
  const empty = await adapter(payload([])).instance.fetch(config, { now: () => at });
  assert.equal(empty.status, "success"); assert.equal(empty.snapshotComplete, true); assert.deepEqual(empty.jobs, []);
  assert.equal(empty.snapshotNamespace, "greenhouse:example-board");
  const sparse = await adapter(payload([{ id: 4, title: "Role", absolute_url: "https://boards.greenhouse.io/example/jobs/4" }]))
    .instance.fetch(config, { now: () => at });
  assert.equal(sparse.status, "success");
  assert.equal(sparse.jobs[0]!.description, ""); assert.equal(sparse.jobs[0]!.location, null);
  assert.equal(sparse.jobs[0]!.sourceUpdatedAt, null); assert.equal(sparse.jobs[0]!.salary, null);
});

test("malformed boards, malformed jobs, invalid URLs and uncertain totals cannot authorize closure", async () => {
  for (const body of ["{", JSON.stringify({ jobs: [] }), JSON.stringify({ jobs: "bad", meta: { total: 0 } })]) {
    const result = await adapter(body).instance.fetch(config, { now: () => at });
    assert.equal(result.status, "failure"); assert.equal(result.snapshotComplete, false);
    assert.equal(result.error?.kind, "payload");
  }
  const partial = await adapter(payload([job, { ...job, id: "bad" }, { ...job, id: 9,
    absolute_url: "javascript:alert(1)" }], 3)).instance.fetch(config, { now: () => at });
  assert.equal(partial.status, "partial"); assert.equal(partial.snapshotComplete, false);
  assert.equal(partial.jobs.length, 1); assert.deepEqual(partial.warnings, [{ code: "invalid_record", count: 2 }]);
  const truncated = await adapter(payload([job], 2)).instance.fetch(config, { now: () => at });
  assert.equal(truncated.status, "partial"); assert.equal(truncated.snapshotComplete, false);
  assert.deepEqual(truncated.warnings, [{ code: "incomplete_board", count: 1 }]);
});

test("invalid timestamps are null and reported as partial source quality", async () => {
  const result = await adapter(payload([{ ...job, updated_at: "not a date" }])).instance.fetch(config, { now: () => at });
  assert.equal(result.status, "partial"); assert.equal(result.snapshotComplete, false);
  assert.equal(result.jobs[0]!.sourceUpdatedAt, null);
  assert.deepEqual(result.warnings, [{ code: "invalid_updated_at", count: 1 }]);
});

test("configuration, HTTP and network failures are structured and never retried in the adapter", async () => {
  let calls = 0;
  const failed = new GreenhouseJobSourceAdapter(registry, async () => {
    calls++; throw new Error("offline");
  });
  const invalidToken = { ...config, config: { ...source, boardToken: "../other" } };
  assert.equal((await failed.fetch(invalidToken, { now: () => at })).error?.kind, "configuration");
  assert.equal((await failed.fetch({ ...config, enabled: false }, { now: () => at })).error?.retryable, false);
  assert.equal(calls, 0);
  const network = await failed.fetch(config, { now: () => at });
  assert.equal(network.status, "failure"); assert.equal(network.error?.code, "network_failure");
  assert.equal(network.error?.retryable, true); assert.equal(calls, 1);
  const http = await adapter("", { error: new CareerFetchError("source", "rate_limited", true) })
    .instance.fetch(config, { now: () => at });
  assert.equal(http.status, "failure"); assert.equal(http.error?.kind, "source");
  assert.equal(http.error?.retryable, true);
});

test("board token namespaces keep provider job IDs distinct and stable across content changes", () => {
  const other = { ...config, sourceId: "other-greenhouse", config: { ...source, id: "other-greenhouse", boardToken: "other-board" } };
  const first = normalizeGreenhouseJob(job, config, "Example Co", at)!;
  const changed = normalizeGreenhouseJob({ ...job, title: "Principal Engineer", location: { name: "Ottawa" } }, config,
    "Example Co", new Date(at.getTime() + 1000))!;
  const separate = normalizeGreenhouseJob(job, other, "Other Co", at)!;
  assert.equal(first.externalId, changed.externalId); assert.equal(first.namespace, changed.namespace);
  assert.notEqual(first.namespace, separate.namespace);
  assert.equal(first.title, "Engineer"); assert.equal(changed.title, "Principal Engineer");
  assert.equal(changed.location, "Ottawa");
});

test("reserved board names and providers have isolated complete snapshot namespaces", async () => {
  const reserved = { ...config, config: { ...source, boardToken: "legacy" } };
  const approved = CompanyRegistrySchema.parse({ ...registry, sources: [reserved.config] });
  const instance = new GreenhouseJobSourceAdapter(approved, async (_source, url) =>
    ({ url, body: payload([]), contentType: "application/json", redirects: [] }));
  const result = await instance.fetch(reserved, { now: () => at });
  assert.equal(result.snapshotComplete, true);
  assert.equal(result.snapshotNamespace, "greenhouse:legacy");
  assert.equal(normalizeGreenhouseJob(job, reserved, "Example", at)!.namespace, "greenhouse:legacy");
  assert.notEqual(providerNamespace("greenhouse", "example-board"), providerNamespace("direct-career-site", "example-board"));
  assert.notEqual(providerNamespace("greenhouse", "a:b"), providerNamespace("greenhouse", "a%3Ab"));
});

test("identical and conflicting IDs are withheld, warn, and never authorize closure", async () => {
  for (const duplicate of [job, { ...job, title: "Conflicting title" }, { id: job.id, title: null }]) {
    const result = await adapter(payload([job, duplicate, { ...job, id: 456 }])).instance.fetch(config, { now: () => at });
    assert.equal(result.status, "partial"); assert.equal(result.snapshotComplete, false);
    assert.deepEqual(result.jobs.map(job => job.externalId), ["456"]);
    assert(result.warnings.some(warning => warning.code === "duplicate_job_id" && warning.count === 1));
    assert.equal(result.warnings.some(warning => warning.code === "conflicting_job_id"), duplicate !== job);
  }
});

test("provider HTML escaping preserves encoded code examples through one sanitization pass", () => {
  for (const content of ["<p>Use List&lt;T&gt; and Map&lt;K,V&gt;.</p>",
    "&lt;p&gt;Use List&amp;lt;T&amp;gt; and Map&amp;lt;K,V&amp;gt;.&lt;/p&gt;",
    "&amp;lt;p&amp;gt;Use List&amp;amp;lt;T&amp;amp;gt; and Map&amp;amp;lt;K,V&amp;amp;gt;.&amp;lt;/p&amp;gt;"]) {
    assert.equal(normalizeGreenhouseJob({ ...job, content }, config, "Example", at)!.description,
      "Use List<T> and Map<K,V>.");
  }
  assert.equal(normalizeGreenhouseJob({ ...job, content: "<p>Example: &lt;p&gt; and &lt;script&gt; are elements.</p>" },
    config, "Example", at)!.description, "Example: <p> and <script> are elements.");
  assert.equal(normalizeGreenhouseJob({ ...job, content: "&lt;p&gt;Safe&lt;/p&gt;&lt;script&gt;bad()&lt;/script&gt;" },
    config, "Example", at)!.description, "Safe");
});
