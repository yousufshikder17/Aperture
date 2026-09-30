import assert from "node:assert/strict";
import test from "node:test";
import { scheduledJobs } from "../src/jobs/scheduler.js";
import { deliverDigest, digestRecipients } from "../src/jobs/digest.js";
import type { Job } from "../src/jobs/queue.js";

test("UTC schedules have stable keys and catch up once in the current period", () => {
  const before = scheduledJobs(new Date("2026-09-29T05:59:00Z"));
  assert.deepEqual(before.map(job => job.kind), ["ingest", "etl"]);
  const morning = scheduledJobs(new Date("2026-09-29T08:00:00Z"));
  assert.deepEqual(morning, scheduledJobs(new Date("2026-09-29T08:59:59Z")));
  assert.deepEqual(morning.map(job => job.kind), ["ingest", "etl", "resource-sync", "digest"]);
  const next = scheduledJobs(new Date("2026-09-30T08:00:00Z"));
  assert.ok(next.every(job => !morning.some(old => old.id === job.id)));
});

test("digest enrollment is explicit; retries reuse a frozen message and expire before provider deduplication", async () => {
  assert.deepEqual(digestRecipients({}), []);
  assert.throws(() => digestRecipients({ DIGEST_USER_IDS: "invalid" }));
  assert.throws(() => digestRecipients({ DIGEST_USER_IDS: "00000000-0000-4000-8000-000000000001" }));
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "synthetic-test-key";
  try {
    const job: Job = { id: "digest:2026-09-29:user", kind: "digest-delivery",
      payload: { from: "test@example.test", to: "user@example.test", text: "Frozen matches" },
      attempts: 0, lastError: null, completedAt: null, availableAt: new Date(), createdAt: new Date() };
    const requests: RequestInit[] = [];
    const send: typeof fetch = async (_url, init) => { requests.push(init!); return new Response("{}", { status: 200 }); };
    await deliverDigest(job, send);
    await deliverDigest(job, send);
    assert.equal(requests[0]!.body, requests[1]!.body);
    assert.equal(new Headers(requests[0]!.headers).get("Idempotency-Key"), job.id);
    await assert.rejects(deliverDigest(job, send, job.createdAt.getTime() + 23 * 3600000));
    assert.equal(requests.length, 2);
    await assert.rejects(deliverDigest(job, async () => new Response("unavailable", { status: 503 })));
  } finally {
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
});
