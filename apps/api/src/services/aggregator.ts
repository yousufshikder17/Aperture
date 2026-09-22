import { XMLParser, XMLValidator } from "fast-xml-parser";
import { db, listings } from "@aperture/db";
import type { ListingSource } from "@aperture/shared";

// MVP listing aggregator: LinkedIn RSS + Indeed RSS.
// V2 adds career-page crawlers, the Wellfound API, and YC/Techstars/Crunchbase
// funding data for startup intelligence.

export interface FeedConfig {
  source: ListingSource;
  url: string;
}

// Operator-configured feeds; scanning does not invent personalized feed URLs.
function configuredFeeds(): FeedConfig[] { return [
  { source: "linkedin_rss", url: process.env.LINKEDIN_RSS_URL ?? "" },
  { source: "indeed_rss", url: process.env.INDEED_RSS_URL ?? "" },
]; }

const parser = new XMLParser({ ignoreAttributes: false });

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  source?: string;
}

function normalize(item: RssItem, source: ListingSource) {
  if (!item || typeof item.link !== "string" || typeof item.title !== "string") return null;
  try { if (!["https:", "http:"].includes(new URL(item.link).protocol)) return null; }
  catch { return null; }
  // "Title - Company" and "Title at Company" are the common RSS title shapes.
  const m = /^(.*?)\s+(?:-|at)\s+(.*)$/.exec(item.title);
  return {
    source,
    url: item.link,
    title: m?.[1]?.trim() ?? item.title,
    company: m?.[2]?.trim() ?? "Unknown",
    description: typeof item.description === "string" ? item.description : "",
    postedAt: typeof item.pubDate === "string" && Number.isFinite(Date.parse(item.pubDate)) ? new Date(item.pubDate) : null,
    location: null,
    salary: null,
    raw: item as Record<string, unknown>,
  };
}

export async function scanFeeds(options: {
  feeds?: FeedConfig[];
  fetch?: typeof fetch;
  insert?: (rows: NonNullable<ReturnType<typeof normalize>>[]) => Promise<number>;
} = {}) {
  let scanned = 0;
  let inserted = 0;
  let succeeded = 0;
  const failedSources: ListingSource[] = [];
  const feeds = (options.feeds ?? configuredFeeds()).filter(feed => feed.url.trim());

  for (const feed of feeds) {
    let items: RssItem[];
    try {
      const res = await (options.fetch ?? fetch)(feed.url, {
        headers: { "user-agent": "aperture/0.1" }, signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error("feed_unavailable");
      const text = await res.text();
      if (XMLValidator.validate(text) !== true) throw new Error("invalid_feed");
      const xml = parser.parse(text);
      if (!xml?.rss?.channel || typeof xml.rss.channel !== "object") throw new Error("invalid_feed");
      items = xml.rss.channel.item ?? [];
    } catch { failedSources.push(feed.source); continue; }
    const rows = (Array.isArray(items) ? items : [items])
      .map((i) => normalize(i, feed.source))
      .filter((r) => r !== null);

    scanned += rows.length;
    if (rows.length) {
      inserted += options.insert ? await options.insert(rows) :
        (await db().insert(listings).values(rows).onConflictDoNothing().returning()).length;
    }
    succeeded++;
  }

  return { scanned, inserted, configured: feeds.length, succeeded, failedSources };
}
