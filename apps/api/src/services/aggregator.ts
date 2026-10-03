import type { ListingSource } from "@aperture/shared";
import { readFeed } from "./feed-reader.js";
import { reconcileListings, type ReconciliationResult } from "./listing-reconciliation.js";
import { RssJobSourceAdapter, rssSourceConfig, type FeedConfig } from "./rss-source.js";
import { configuredSources } from "./source-config.js";
import type { JobSourceAdapter, JobSourceConfig, JobSourceContext } from "./job-source.js";
import type { NormalizedJob } from "./normalized-job.js";
export type { FeedConfig } from "./rss-source.js";
export { configuredFeeds } from "./source-config.js";

export async function scanSources<TConfig>(
  sources: JobSourceConfig<TConfig>[], adapter: JobSourceAdapter<TConfig>,
  options: {
    reconcile: (jobs: NormalizedJob[]) => Promise<ReconciliationResult[]>;
    context?: JobSourceContext;
  },
) {
  let scanned = 0, inserted = 0, succeeded = 0;
  const failedSources: ListingSource[] = [];
  const enabled = sources.filter(source => source.enabled);
  const context: JobSourceContext = {
    log: event => console.info("job_source_fetch", event),
    ...options.context,
  };
  for (const source of enabled) {
    const result = await adapter.fetch(source, context);
    if (result.status === "failure") { failedSources.push(source.source); continue; }
    scanned += result.jobs.length;
    if (result.jobs.length) {
      const reconciled = await options.reconcile(result.jobs);
      inserted += reconciled.filter(row => row.outcome === "created").length;
    }
    // Partial feeds retain the existing behavior: valid records are ingested, invalid ones skipped.
    // They never authorize absence-based closure (nor do successful RSS results).
    succeeded++;
  }
  return { scanned, inserted, configured: enabled.length, succeeded, failedSources };
}

export async function scanFeeds(options: {
  feeds?: FeedConfig[];
  fetch?: typeof fetch;
  reconcile?: typeof reconcileListings;
  context?: JobSourceContext;
} = {}) {
  const sources = options.feeds?.map(rssSourceConfig) ?? configuredSources();
  return scanSources(sources, new RssJobSourceAdapter((url, context) => readFeed(url, options.fetch, context)), {
    reconcile: options.reconcile ?? reconcileListings,
    context: options.context,
  });
}
