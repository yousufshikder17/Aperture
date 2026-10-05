import { createHash } from "node:crypto";
import type { ListingSource } from "@aperture/shared";
import { NormalizedJobSchema } from "./normalized-job.js";
import type { JobSourceAdapter, JobSourceConfig, JobSourceContext, JobSourceError, JobSourceFetchResult } from "./job-source.js";
import { FeedReadError, parseFeed, validateFeedUrl } from "./feed-reader.js";
import { careerText } from "./career-text.js";

export interface FeedConfig { source: ListingSource; url: string }

// Namespace GUIDs by the configured feed: RSS IDs need not be globally unique.
export function normalizeRssItem(value: unknown, feed: FeedConfig, observedAt: Date) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.link !== "string" || typeof item.title !== "string") return null;
  const name = /^(.*?)\s+(?:-|at)\s+(.*)$/.exec(item.title);
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
  const jobicy = feed.source === "jobicy";
  const company = (jobicy ? text(item["job_listing:company"]) : null) ?? text(item.company);
  const location = (jobicy ? text(item["job_listing:location"]) : null) ?? text(item.location);
  const employmentType = (jobicy ? text(item["job_listing:job_type"]) : null) ?? text(item.employmentType);
  const content = jobicy ? text(item["content:encoded"]) : null;
  const guid = typeof item.guid === "object" && item.guid !== null
    ? (item.guid as Record<string, unknown>)["#text"] : item.guid;
  const result = NormalizedJobSchema.safeParse({
    source: feed.source,
    namespace: rssNamespace(feed.url),
    externalId: typeof guid === "string" && guid.trim() ? guid.trim() : null,
    url: item.link,
    sourceUrl: item.link, canonicalUrl: item.link,
    title: company ? item.title : name?.[1]?.trim() ?? item.title,
    company: company ?? (name?.[2]?.trim() || "Unknown"),
    description: content ? careerText(content) : typeof item.description === "string" ? item.description : "",
    postedAt: typeof item.pubDate === "string" && Number.isFinite(Date.parse(item.pubDate)) ? new Date(item.pubDate) : null,
    sourceUpdatedAt: null, observedAt,
    // An RSS entry is discovery evidence, not a guarantee that a position remains open.
    availability: "unknown", location, employmentType, salary: null, raw: item,
  });
  return result.success ? result.data : null;
}

export interface RssConfig { url: string }
export type RssSourceConfig = JobSourceConfig<RssConfig> & { provider: "rss" };
export function rssNamespace(url: string) {
  return "rss:" + createHash("sha256").update(url.trim()).digest("hex");
}
export function rssSourceConfig(feed: FeedConfig): RssSourceConfig {
  return { provider: "rss", sourceId: rssNamespace(feed.url), source: feed.source as RssSourceConfig["source"],
    enabled: !!feed.url.trim(), config: { url: feed.url } };
}
type RssReader = (url: string, context?: JobSourceContext) => Promise<string>;
export class RssJobSourceAdapter implements JobSourceAdapter<RssConfig> {
  readonly provider = "rss";
  constructor(private readonly read: RssReader) {}
  async fetch(source: JobSourceConfig<RssConfig>, context: JobSourceContext = {}): Promise<JobSourceFetchResult> {
    const clock = context.now ?? (() => new Date());
    const fetchedAt = clock();
    const metadata = { provider: this.provider, sourceId: source.sourceId, source: source.source,
      fetchedAt, snapshotComplete: false as const, recordsReceived: 0, durationMs: 0 };
    let result: JobSourceFetchResult;
    try {
      if (source.provider !== this.provider || !source.enabled ||
          !source.config || typeof source.config.url !== "string" ||
          !NormalizedJobSchema.shape.source.safeParse(source.source).success)
        throw new FeedReadError("configuration", "invalid_source_config", false);
      validateFeedUrl(source.config.url);
      if (source.sourceId !== rssNamespace(source.config.url))
        throw new FeedReadError("configuration", "invalid_source_identity", false);
      if (context.timeoutMs !== undefined && (!Number.isInteger(context.timeoutMs) ||
          context.timeoutMs <= 0 || context.timeoutMs > 2_147_483_647))
        throw new FeedReadError("configuration", "invalid_timeout", false);
      context.signal?.throwIfAborted();
      const items = parseFeed(await this.read(source.config.url, context));
      metadata.recordsReceived = items.length;
      const jobs = items.map(item => normalizeRssItem(item, { source: source.source, url: source.config.url }, fetchedAt))
        .filter(job => job !== null);
      const rejected = items.length - jobs.length;
      result = rejected
        ? { ...metadata, status: "partial", jobs, warnings: [{ code: "invalid_record", count: rejected }] }
        : { ...metadata, status: "success", jobs, warnings: [] };
    } catch (error) {
      const failure: JobSourceError = error instanceof FeedReadError
        ? { kind: error.kind, code: error.code, retryable: error.retryable }
        : { kind: "source", code: context.signal?.aborted ? "aborted" :
            error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error",
            retryable: !context.signal?.aborted };
      result = { ...metadata, status: "failure", jobs: [], warnings: [], error: failure };
    }
    result.durationMs = Math.max(0, clock().getTime() - fetchedAt.getTime());
    // Observability must not turn successful retrieval into an ingestion failure.
    try { context.log?.({ provider: result.provider, sourceId: result.sourceId, source: result.source,
      runId: context.runId, status: result.status, recordsReceived: result.recordsReceived,
      normalized: result.jobs.length, warnings: result.warnings.reduce((sum, warning) => sum + warning.count, 0),
      durationMs: result.durationMs, errorKind: result.error?.kind, errorCode: result.error?.code }); } catch {}
    return result;
  }
}
