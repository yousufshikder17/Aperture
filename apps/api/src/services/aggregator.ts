import { XMLParser } from "fast-xml-parser";
import { db, listings } from "@aperture/db";
import type { ListingSource } from "@aperture/shared";

// MVP listing aggregator: LinkedIn RSS + Indeed RSS.
// V2 adds career-page crawlers, the Wellfound API, and YC/Techstars/Crunchbase
// funding data for startup intelligence.

interface FeedConfig {
  source: ListingSource;
  url: string;
}

// Feed URLs are query-templated per target role/location; these defaults are
// placeholders — real feeds are constructed from the user's targetRoles.
const FEEDS: FeedConfig[] = [
  { source: "linkedin_rss", url: process.env.LINKEDIN_RSS_URL ?? "" },
  { source: "indeed_rss", url: process.env.INDEED_RSS_URL ?? "" },
];

const parser = new XMLParser({ ignoreAttributes: false });

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  source?: string;
}

function normalize(item: RssItem, source: ListingSource) {
  if (!item.link || !item.title) return null;
  // "Title - Company" and "Title at Company" are the common RSS title shapes.
  const m = /^(.*?)\s+(?:-|at)\s+(.*)$/.exec(item.title);
  return {
    source,
    url: item.link,
    title: m?.[1]?.trim() ?? item.title,
    company: m?.[2]?.trim() ?? "Unknown",
    description: item.description ?? "",
    postedAt: item.pubDate ? new Date(item.pubDate) : null,
    location: null,
    salary: null,
    raw: item as Record<string, unknown>,
  };
}

export async function scanFeeds(): Promise<{ scanned: number; inserted: number }> {
  let scanned = 0;
  let inserted = 0;

  for (const feed of FEEDS) {
    if (!feed.url) continue;
    const res = await fetch(feed.url, { headers: { "user-agent": "aperture/0.1" } });
    if (!res.ok) continue;

    const xml = parser.parse(await res.text());
    const items: RssItem[] = xml?.rss?.channel?.item ?? [];
    const rows = (Array.isArray(items) ? items : [items])
      .map((i) => normalize(i, feed.source))
      .filter((r) => r !== null);

    scanned += rows.length;
    if (rows.length) {
      const result = await db().insert(listings).values(rows).onConflictDoNothing().returning();
      inserted += result.length;
    }
  }

  return { scanned, inserted };
}
