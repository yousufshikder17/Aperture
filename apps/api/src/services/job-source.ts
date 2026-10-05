import type { ListingSource } from "@aperture/shared";
import type { NormalizedJob } from "./normalized-job.js";

// Provider identifies the transport/integration, not the existing product-facing source label.
// Provider selection belongs to the centralized resolver.
export type JobSourceProvider = string;
export interface JobSourceConfig<TConfig> {
  provider: JobSourceProvider;
  sourceId: string;
  source: Exclude<ListingSource, "manual">;
  enabled: boolean;
  config: TConfig;
}
export interface JobSourceContext {
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => Date;
  runId?: string;
  log?: (event: JobSourceLog) => void;
}
export interface JobSourceLog {
  provider: JobSourceProvider;
  sourceId: string;
  source: Exclude<ListingSource, "manual">;
  runId?: string;
  status: JobSourceFetchResult["status"];
  recordsReceived: number;
  normalized: number;
  warnings: number;
  durationMs: number;
  errorKind?: JobSourceError["kind"];
  errorCode?: string;
}
export interface JobSourceError {
  kind: "configuration" | "source" | "payload";
  code: string;
  retryable: boolean;
}
interface FetchMetadata {
  provider: JobSourceProvider;
  sourceId: string;
  source: Exclude<ListingSource, "manual">;
  fetchedAt: Date;
  durationMs: number;
  recordsReceived: number;
}
export type JobSourceFetchResult = FetchMetadata & (
  // True only for an authoritative, fully consumed snapshot, never merely a successful request.
  | { status: "success"; snapshotComplete: true; snapshotNamespace: string; jobs: NormalizedJob[]; warnings: []; error?: never }
  | { status: "success"; snapshotComplete: false; snapshotNamespace?: never; jobs: NormalizedJob[]; warnings: []; error?: never }
  | { status: "partial"; snapshotComplete: false; snapshotNamespace?: never; jobs: NormalizedJob[];
      warnings: { code: string; count: number }[]; error?: never }
  | { status: "failure"; snapshotComplete: false; snapshotNamespace?: never; jobs: []; warnings: []; error: JobSourceError }
);
export interface JobSourceAdapter<TConfig> {
  readonly provider: JobSourceProvider;
  // Consume pagination internally. Failure/partial results cannot authorize absence-based closure.
  fetch(source: JobSourceConfig<TConfig>, context?: JobSourceContext): Promise<JobSourceFetchResult>;
}
