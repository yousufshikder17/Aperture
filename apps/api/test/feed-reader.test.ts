import assert from "node:assert/strict";
import test from "node:test";
import { readFeed, FEED_MAX_BYTES } from "../src/services/feed-reader.js";
import { scanFeeds } from "../src/services/aggregator.js";

test("feed reader enforces declared and streamed byte limits and cancels oversized bodies", async () => {
  for (const declared of [true, false]) {
    let cancelled = false;
    const response = new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(FEED_MAX_BYTES + 1)); },
      cancel() { cancelled = true; },
    }), { headers: declared ? { "content-length": String(FEED_MAX_BYTES + 1) } : {} });
    await assert.rejects(readFeed("https://example.test", async () => response));
    assert.equal(cancelled, true);
  }
  assert.equal((await readFeed("https://example.test", async () => new Response("x".repeat(FEED_MAX_BYTES)))).length, FEED_MAX_BYTES);
});

test("oversized feed is a partial scan failure and the next request retries successfully", async () => {
  const good = '<rss><channel><item><title>Engineer</title><link>https://example.test/job</link></item></channel></rss>';
  let fail = true;
  const options = {
    feeds: [{ source: "manual" as const, url: "https://example.test/one" }, { source: "manual" as const, url: "https://example.test/two" }],
    fetch: (async (url) => new Response(fail && String(url).endsWith("one") ? "x".repeat(FEED_MAX_BYTES + 1) : good)) as typeof fetch,
    insert: async () => 1,
  };
  assert.deepEqual(await scanFeeds(options), { configured: 2, succeeded: 1, scanned: 1, inserted: 1, failedSources: ["manual"] });
  fail = false;
  assert.equal((await scanFeeds(options)).succeeded, 2);
});
