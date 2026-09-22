import assert from "node:assert/strict";
import test from "node:test";
import { scanFeeds } from "../src/services/aggregator.js";

test("unconfigured feeds are distinguishable from a successful empty scan", async () => {
  assert.deepEqual(await scanFeeds({ feeds: [] }), { scanned: 0, inserted: 0, configured: 0, succeeded: 0, failedSources: [] });
});
test("RSS normalization handles singleton items, invalid dates, unsafe links and partial outages", async () => {
  const rows: unknown[] = [];
  const result = await scanFeeds({ feeds: [{ source: "linkedin_rss", url: "https://example.test/good" },
    { source: "indeed_rss", url: "https://example.test/bad" }],
    fetch: async (url, init) => {
      assert(init?.signal);
      if (String(url).endsWith("bad")) throw new Error("private network detail");
      return new Response('<rss><channel><item><title>Engineer at Example</title><link>https://example.test/job</link><pubDate>bad</pubDate></item></channel></rss>');
    }, insert: async values => { rows.push(...values); return 1; },
  });
  assert.deepEqual(result, { scanned: 1, inserted: 1, configured: 2, succeeded: 1, failedSources: ["indeed_rss"] });
  assert.equal((rows[0] as { postedAt: unknown }).postedAt, null);
  const unsafe = await scanFeeds({ feeds: [{ source: "manual", url: "https://example.test" }],
    fetch: async () => new Response('<rss><channel><item><title>Bad</title><link>javascript:alert(1)</link></item></channel></rss>'),
    insert: async () => { throw new Error("unsafe row reached persistence"); },
  });
  assert.equal(unsafe.scanned, 0);
});
test("invalid XML and HTTP failures are failures, while repeated valid rows may insert zero", async () => {
  for (const response of [new Response("unavailable", { status: 503 }), new Response("<rss>"), new Response("<html>wrong feed</html>")]) {
    const result = await scanFeeds({ feeds: [{ source: "manual", url: "https://example.test" }], fetch: async () => response });
    assert.equal(result.succeeded, 0);
    assert.deepEqual(result.failedSources, ["manual"]);
  }
  const result = await scanFeeds({ feeds: [{ source: "manual", url: "https://example.test" }],
    fetch: async () => new Response('<rss><channel><title>Jobs</title><item><title>Engineer</title><link>https://example.test/job</link></item></channel></rss>'),
    insert: async () => 0 });
  assert.equal(result.scanned, 1);
  assert.equal(result.inserted, 0);
  assert.equal(result.succeeded, 1);
});
