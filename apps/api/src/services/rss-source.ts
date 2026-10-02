import { createHash } from "node:crypto";
import type { ListingSource } from "@aperture/shared";
import { NormalizedJobSchema } from "./normalized-job.js";

export interface FeedConfig { source: ListingSource; url: string }

// Namespace GUIDs by the configured feed: RSS IDs need not be globally unique.
export function normalizeRssItem(value: unknown, feed: FeedConfig, observedAt: Date) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.link !== "string" || typeof item.title !== "string") return null;
  const name = /^(.*?)\s+(?:-|at)\s+(.*)$/.exec(item.title);
  const guid = typeof item.guid === "object" && item.guid !== null
    ? (item.guid as Record<string, unknown>)["#text"] : item.guid;
  const result = NormalizedJobSchema.safeParse({
    source: feed.source,
    namespace: "rss:" + createHash("sha256").update(feed.url.trim()).digest("hex"),
    externalId: typeof guid === "string" && guid.trim() ? guid.trim() : null,
    url: item.link,
    title: name?.[1]?.trim() ?? item.title,
    company: name?.[2]?.trim() || "Unknown",
    description: typeof item.description === "string" ? item.description : "",
    postedAt: typeof item.pubDate === "string" && Number.isFinite(Date.parse(item.pubDate)) ? new Date(item.pubDate) : null,
    sourceUpdatedAt: null, observedAt,
    // An RSS entry is discovery evidence, not a guarantee that a position remains open.
    availability: "unknown", location: null, salary: null, raw: item,
  });
  return result.success ? result.data : null;
}
