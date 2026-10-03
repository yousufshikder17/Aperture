import type { ListingSource } from "@aperture/shared";
import { readFeed, parseFeed } from "./feed-reader.js";
import { normalizeRssItem, type FeedConfig } from "./rss-source.js";
import { reconcileListings } from "./listing-reconciliation.js";
export type { FeedConfig } from "./rss-source.js";

// Operator-configured feeds; scanning does not invent personalized feed URLs.
function configuredFeeds(): FeedConfig[] { return [
  { source: "linkedin_rss", url: process.env.LINKEDIN_RSS_URL ?? "" },
  { source: "indeed_rss", url: process.env.INDEED_RSS_URL ?? "" },
]; }


export async function scanFeeds(options: {
  feeds?: FeedConfig[];
  fetch?: typeof fetch;
  reconcile?: typeof reconcileListings;
} = {}) {
  let scanned = 0, inserted = 0, succeeded = 0;
  const failedSources: ListingSource[] = [];
  const feeds = (options.feeds ?? configuredFeeds()).filter(feed => feed.url.trim());
  for (const feed of feeds) {
    const observedAt = new Date();
    let items: unknown[];
    try { items = parseFeed(await readFeed(feed.url, options.fetch)); }
    catch { failedSources.push(feed.source); continue; }
    const rows = items.map(item => normalizeRssItem(item, feed, observedAt)).filter(row => row !== null);
    scanned += rows.length;
    if (rows.length) {
      const results = await (options.reconcile ?? reconcileListings)(rows);
      inserted += results.filter(result => result.outcome === "created").length;
    }
    succeeded++;
  }
  return { scanned, inserted, configured: feeds.length, succeeded, failedSources };
}
