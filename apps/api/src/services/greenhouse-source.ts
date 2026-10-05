import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { CareerUrlSchema, GreenhouseSourceSchema, type CompanyRegistry, type GreenhouseSource } from "@aperture/shared";
import { careerText } from "./career-text.js";
import { createCareerReader, CareerFetchError, type CareerReader } from "./career-http.js";
import type { JobSourceAdapter, JobSourceConfig, JobSourceContext, JobSourceError, JobSourceFetchResult } from "./job-source.js";
import { NormalizedJobSchema, providerNamespace } from "./normalized-job.js";

const API_HOST = "boards-api.greenhouse.io";
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const record = z.object({ id: z.number().int().positive().safe(), title: z.string().trim().min(1),
  absolute_url: z.string().min(1), updated_at: z.string().optional(), content: z.string().nullable().optional(),
  location: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  departments: z.array(z.record(z.string(), z.unknown())).optional(),
  offices: z.array(z.record(z.string(), z.unknown())).optional() }).passthrough();
const board = z.object({ jobs: z.array(z.unknown()), meta: z.object({ total: z.number().int().nonnegative() }) });

export type GreenhouseJobSourceConfig = JobSourceConfig<GreenhouseSource>;
export function greenhouseEndpoint(boardToken: string) {
  return `https://${API_HOST}/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
}
function safeHttps(value: string) {
  try { const url = new URL(value); return CareerUrlSchema.safeParse(url.href).success ? url.href : null; }
  catch { return null; }
}
function greenhouseContent(value: string) {
  // Decode whole transport layers before sanitization. Never decode entities inside ordinary HTML again.
  const escapedHtml = /^\s*&(?:amp;)*lt;\/?(?:p|div|section|article|ul|ol|li|br|h[1-6]|a|span|strong|b|em|table|blockquote|pre|code|script|style|template|noscript)(?:\s|&)/i;
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  for (let pass = 0; pass < 2 && escapedHtml.test(value); pass++)
    value = value.replace(/&(amp|lt|gt|quot|apos);/gi, (_match, entity: string) => entities[entity.toLowerCase()]!);
  return value;
}
export function normalizeGreenhouseJob(value: unknown, source: GreenhouseJobSourceConfig,
  company: string, observedAt: Date) {
  const parsed = record.safeParse(value);
  if (!parsed.success) return null;
  const item = parsed.data;
  const url = safeHttps(item.absolute_url);
  if (!url || item.departments && item.departments.some(value => !value || typeof value !== "object" || Array.isArray(value)) ||
      item.offices && item.offices.some(value => !value || typeof value !== "object" || Array.isArray(value))) return null;
  const updatedAt = item.updated_at && Number.isFinite(Date.parse(item.updated_at)) ? new Date(item.updated_at) : null;
  const normalized = NormalizedJobSchema.safeParse({
    source: source.source, namespace: providerNamespace(source.provider, source.config.boardToken), externalId: String(item.id),
    url, sourceUrl: url, canonicalUrl: url, applicationUrl: url, employmentType: null,
    title: item.title, company, description: item.content == null ? "" : careerText(greenhouseContent(item.content)),
    location: item.location?.name ?? null, salary: null, postedAt: null, sourceUpdatedAt: updatedAt,
    observedAt, availability: "open",
    raw: { id: item.id, ...(item.updated_at ? { updated_at: item.updated_at } : {}),
    ...(item.departments ? { departments: item.departments } : {}), ...(item.offices ? { offices: item.offices } : {}) },
  });
  return normalized.success ? normalized.data : null;
}

export class GreenhouseJobSourceAdapter implements JobSourceAdapter<GreenhouseSource> {
  readonly provider = "greenhouse";
  constructor(private readonly registry: CompanyRegistry,
    private readonly read: CareerReader = createCareerReader({ maxBytes: MAX_RESPONSE_BYTES })) {}

  async fetch(input: JobSourceConfig<GreenhouseSource>, context: JobSourceContext = {}): Promise<JobSourceFetchResult> {
    const started = Date.now();
    const fetchedAt = (context.now ?? (() => new Date()))();
    const metadata = { provider: this.provider, sourceId: input.sourceId, source: input.source,
      fetchedAt, durationMs: 0, recordsReceived: 0 };
    let result: JobSourceFetchResult;
    try {
      const parsed = GreenhouseSourceSchema.safeParse(input.config);
      const approved = parsed.success && this.registry.sources.find((item): item is GreenhouseSource =>
        item.provider === this.provider && item.id === parsed.data.id);
      const company = this.registry.companies.find(item => item.id === input.config?.companyId);
      if (!parsed.success || input.provider !== this.provider || !input.enabled || !parsed.data.enabled ||
          input.source !== "career_page" || input.sourceId !== parsed.data.id || !company?.enabled ||
          !approved || approved.companyId !== parsed.data.companyId || approved.boardToken !== parsed.data.boardToken ||
          !approved.enabled ||
          parsed.data.support !== "supported" || context.timeoutMs !== undefined &&
            (!Number.isInteger(context.timeoutMs) || context.timeoutMs < 1 || context.timeoutMs > 30_000))
        throw new CareerFetchError("configuration", "invalid_or_disabled_source");
      context.signal?.throwIfAborted();
      const endpoint = greenhouseEndpoint(parsed.data.boardToken);
      const page = await this.read({ url: endpoint, expectedHostname: API_HOST, redirectHosts: [] }, endpoint, context);
      if (page.contentType !== "application/json") throw new CareerFetchError("payload", "unexpected_content_type");
      let payload: unknown;
      try { payload = JSON.parse(page.body) as unknown; }
      catch { throw new CareerFetchError("payload", "malformed_json"); }
      const parsedBoard = board.safeParse(payload);
      if (!parsedBoard.success) throw new CareerFetchError("payload", "invalid_board_payload");
      metadata.recordsReceived = parsedBoard.data.jobs.length;
      const identities = new Map<number, unknown[]>();
      for (const value of parsedBoard.data.jobs) {
        if (value && typeof value === "object" && "id" in value && typeof value.id === "number") {
          const records = identities.get(value.id) ?? [];
          records.push(value); identities.set(value.id, records);
        }
      }
      const duplicates = [...identities.values()].filter(values => values.length > 1);
      const conflicting = duplicates.filter(values => values.some(value => !isDeepStrictEqual(value, values[0])));
      const normalized = parsedBoard.data.jobs.map(value => normalizeGreenhouseJob(value, input, company.name, fetchedAt));
      const rejected = normalized.filter(job => job === null).length;
      const jobs = normalized.filter(job => job !== null).filter(job => identities.get(Number(job.externalId))?.length === 1);
      const invalidTimestamps = parsedBoard.data.jobs.filter(value => {
        const item = record.safeParse(value);
        return item.success && !!item.data.updated_at && !Number.isFinite(Date.parse(item.data.updated_at));
      }).length;
      const countMismatch = parsedBoard.data.meta.total !== parsedBoard.data.jobs.length;
      const warnings = [
        ...(rejected ? [{ code: "invalid_record", count: rejected }] : []),
        ...(invalidTimestamps ? [{ code: "invalid_updated_at", count: invalidTimestamps }] : []),
        ...(countMismatch ? [{ code: "incomplete_board", count: 1 }] : []),
        ...(duplicates.length ? [{ code: "duplicate_job_id", count: duplicates.length }] : []),
        ...(conflicting.length ? [{ code: "conflicting_job_id", count: conflicting.length }] : []),
      ];
      const namespace = providerNamespace(this.provider, parsed.data.boardToken);
      result = warnings.length ? { ...metadata, status: "partial", snapshotComplete: false, jobs, warnings } :
        { ...metadata, status: "success", snapshotComplete: true, snapshotNamespace: namespace, jobs, warnings: [] };
    } catch (error) {
      const failure: JobSourceError = error instanceof CareerFetchError
        ? { kind: error.kind, code: error.code, retryable: error.retryable }
        : { kind: "source", code: context.signal?.aborted ? "request_cancelled" :
            error instanceof Error && error.name === "TimeoutError" ? "request_timeout" : "network_failure",
            retryable: !context.signal?.aborted };
      result = { ...metadata, status: "failure", snapshotComplete: false, jobs: [], warnings: [], error: failure };
    }
    result.durationMs = Math.max(0, Date.now() - started);
    try { context.log?.({ provider: result.provider, sourceId: result.sourceId, source: result.source,
      runId: context.runId, status: result.status, recordsReceived: result.recordsReceived,
      normalized: result.jobs.length, warnings: result.warnings.reduce((sum, warning) => sum + warning.count, 0),
      durationMs: result.durationMs, errorKind: result.error?.kind, errorCode: result.error?.code }); } catch {}
    return result;
  }
}
