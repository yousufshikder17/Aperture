import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { CareerUrlSchema, LeverSourceSchema, type CompanyRegistry, type LeverSource } from "@aperture/shared";
import { careerText } from "./career-text.js";
import { CareerFetchError, createCareerReader, type CareerReader } from "./career-http.js";
import type { JobSourceAdapter, JobSourceConfig, JobSourceContext, JobSourceError, JobSourceFetchResult } from "./job-source.js";
import { NormalizedJobSchema, providerNamespace } from "./normalized-job.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const MAX_SCAN_BYTES = 16 * 1024 * 1024;
const text = z.string().nullable().optional();
const posting = z.object({
  id: z.string().min(1).max(1000).refine(value => value === value.trim()), text: z.string().trim().min(1),
  hostedUrl: z.string(), applyUrl: text,
  categories: z.object({ location: text, commitment: text, team: text, department: text,
    allLocations: z.array(z.string()).optional() }).passthrough().nullable().optional(),
  // Official demo responses also use "onsite"; retain that spelling as provider metadata.
  country: text, workplaceType: z.enum(["unspecified", "on-site", "onsite", "remote", "hybrid"]).nullable().optional(),
  opening: text, openingPlain: text, description: text, descriptionPlain: text,
  descriptionBody: text, descriptionBodyPlain: text, additional: text, additionalPlain: text,
  salaryDescription: text, salaryDescriptionPlain: text,
  lists: z.array(z.object({ text: z.string(), content: z.string() })).nullable().optional(),
  salaryRange: z.object({ currency: z.string().max(100).optional(), interval: z.string().max(100).optional(),
    min: z.number().finite().nonnegative().optional(), max: z.number().finite().nonnegative().optional() })
    .refine(value => value.min === undefined || value.max === undefined || value.min <= value.max).nullable().optional(),
}).passthrough();

export function leverEndpoint(site: string, region: LeverSource["region"] = "global", skip = 0) {
  const host = region === "eu" ? "api.eu.lever.co" : "api.lever.co";
  return `https://${host}/v0/postings/${encodeURIComponent(site)}?mode=json&skip=${skip}&limit=${PAGE_SIZE}`;
}
function postingUrl(value: string, config: LeverSource, id: string, apply = false) {
  if (!CareerUrlSchema.safeParse(value).success) return null;
  const url = new URL(value);
  const host = config.region === "eu" ? "jobs.eu.lever.co" : "jobs.lever.co";
  const path = `/${encodeURIComponent(config.site)}/${encodeURIComponent(id)}${apply ? "/apply" : ""}`;
  return url.hostname === host && url.pathname.replace(/\/$/, "") === path ? url.href : null;
}
const escapedText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function htmlOrPlain(html: string | null | undefined, plain: string | null | undefined) {
  return html || (plain ? escapedText(plain) : "");
}
export function normalizeLeverJob(value: unknown, source: JobSourceConfig<LeverSource>, company: string, observedAt: Date) {
  const parsed = posting.safeParse(value);
  if (!parsed.success) return null;
  const item = parsed.data, range = item.salaryRange;
  const url = postingUrl(item.hostedUrl, source.config, item.id);
  const applicationUrl = item.applyUrl ? postingUrl(item.applyUrl, source.config, item.id, true) : undefined;
  if (!url || item.applyUrl && !applicationUrl) return null;
  const description = htmlOrPlain(item.description, item.descriptionPlain) ||
    [htmlOrPlain(item.opening, item.openingPlain), htmlOrPlain(item.descriptionBody, item.descriptionBodyPlain)].filter(Boolean).join("\n");
  const content = [description, ...(item.lists ?? []).map(list => `<p>${escapedText(list.text)}</p>${list.content}`),
    htmlOrPlain(item.salaryDescription, item.salaryDescriptionPlain), htmlOrPlain(item.additional, item.additionalPlain)].filter(Boolean).join("\n");
  const salary = range?.currency && range.interval && range.min !== undefined && range.max !== undefined ?
    `${range.currency} ${range.min === range.max ? range.min : `${range.min}–${range.max}`} / ${range.interval}` : null;
  const normalized = NormalizedJobSchema.safeParse({ source: source.source,
    namespace: providerNamespace("lever", `${source.config.region}/${source.config.site}`), externalId: item.id,
    url, sourceUrl: url, canonicalUrl: url, ...(applicationUrl ? { applicationUrl } : {}),
    employmentType: item.categories?.commitment || null, title: item.text, company,
    description: careerText(content), location: item.categories?.location || item.categories?.allLocations?.join("; ") || null,
    salary, postedAt: null, sourceUpdatedAt: null, observedAt, availability: "open",
    raw: { id: item.id, ...(item.categories ? { categories: item.categories } : {}),
      ...(item.country != null ? { country: item.country } : {}),
      ...(item.workplaceType != null ? { workplaceType: item.workplaceType } : {}),
      ...(range ? { salaryRange: range } : {}),
      ...(item.createdAt !== undefined ? { createdAt: item.createdAt } : {}),
      ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}) },
  });
  return normalized.success ? normalized.data : null;
}

export class LeverJobSourceAdapter implements JobSourceAdapter<LeverSource> {
  readonly provider = "lever";
  constructor(private readonly registry: CompanyRegistry, private readonly read: CareerReader = createCareerReader()) {}

  async fetch(input: JobSourceConfig<LeverSource>, context: JobSourceContext = {}): Promise<JobSourceFetchResult> {
    const started = Date.now(), fetchedAt = (context.now ?? (() => new Date()))();
    const metadata = { provider: this.provider, sourceId: input.sourceId, source: input.source, fetchedAt, durationMs: 0, recordsReceived: 0 };
    let result: JobSourceFetchResult;
    let deadline: AbortSignal | undefined;
    try {
      const parsed = LeverSourceSchema.safeParse(input.config);
      const approved = parsed.success && this.registry.sources.find((source): source is LeverSource =>
        source.provider === this.provider && source.id === parsed.data.id);
      const company = this.registry.companies.find(company => company.id === input.config?.companyId);
      if (!parsed.success || input.provider !== this.provider || input.source !== "career_page" || !input.enabled ||
          !parsed.data.enabled || input.sourceId !== parsed.data.id || !company?.enabled || !approved || !approved.enabled ||
          approved.support !== "supported" || approved.companyId !== parsed.data.companyId ||
          approved.site !== parsed.data.site || approved.region !== parsed.data.region ||
          context.timeoutMs !== undefined && (!Number.isInteger(context.timeoutMs) || context.timeoutMs < 1 || context.timeoutMs > 30_000))
        throw new CareerFetchError("configuration", "invalid_or_disabled_source");
      deadline = AbortSignal.timeout(context.timeoutMs ?? 15_000);
      const signal = AbortSignal.any([deadline, ...(context.signal ? [context.signal] : [])]);
      const values: unknown[] = [];
      let bytes = 0, complete = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        signal.throwIfAborted();
        const endpoint = leverEndpoint(parsed.data.site, parsed.data.region, values.length);
        const response = await this.read({ url: endpoint, expectedHostname: new URL(endpoint).hostname, redirectHosts: [] },
          endpoint, { ...context, signal });
        if (response.contentType !== "application/json") throw new CareerFetchError("payload", "unexpected_content_type");
        bytes += Buffer.byteLength(response.body);
        if (bytes > MAX_SCAN_BYTES) throw new CareerFetchError("payload", "scan_too_large");
        let payload: unknown;
        try { payload = JSON.parse(response.body) as unknown; } catch { throw new CareerFetchError("payload", "malformed_json"); }
        const pageRecords = z.array(z.unknown()).safeParse(payload);
        if (!pageRecords.success || pageRecords.data.length > PAGE_SIZE) throw new CareerFetchError("payload", "invalid_postings_payload");
        // Explicitly consume offsets until an empty page; a short page is not proof of exhaustion.
        if (!pageRecords.data.length) { complete = true; break; }
        values.push(...pageRecords.data); metadata.recordsReceived = values.length;
      }
      const identities = new Map<string, unknown[]>();
      for (const value of values) if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
        const records = identities.get(value.id) ?? []; records.push(value); identities.set(value.id, records);
      }
      const duplicates = [...identities.values()].filter(records => records.length > 1);
      const conflicting = duplicates.filter(records => records.some(value => !isDeepStrictEqual(value, records[0])));
      const normalized = values.map(value => normalizeLeverJob(value, input, company.name, fetchedAt));
      const rejected = normalized.filter(job => job === null).length;
      const jobs = normalized.filter(job => job !== null).filter(job => identities.get(job.externalId!)?.length === 1);
      const warnings = [
        ...(!complete ? [{ code: "pagination_limit", count: 1 }] : []),
        ...(rejected ? [{ code: "invalid_record", count: rejected }] : []),
        ...(duplicates.length ? [{ code: "duplicate_job_id", count: duplicates.length }] : []),
        ...(conflicting.length ? [{ code: "conflicting_job_id", count: conflicting.length }] : []),
      ];
      result = warnings.length ? { ...metadata, status: "partial", snapshotComplete: false, jobs, warnings } :
        { ...metadata, status: "success", snapshotComplete: true,
          snapshotNamespace: providerNamespace(this.provider, `${parsed.data.region}/${parsed.data.site}`), jobs, warnings: [] };
    } catch (error) {
      const failure: JobSourceError = error instanceof CareerFetchError ? { kind: error.kind, code: error.code, retryable: error.retryable } :
        { kind: "source", code: context.signal?.aborted ? "request_cancelled" : deadline?.aborted ||
          error instanceof Error && (error.name === "TimeoutError" || error.cause instanceof Error && error.cause.name === "TimeoutError") ?
            "request_timeout" : "network_failure", retryable: !context.signal?.aborted };
      // Discard accumulated pages on retrieval failure so the existing durable worker owns the retry.
      result = { ...metadata, status: "failure", snapshotComplete: false, jobs: [], warnings: [], error: failure };
    }
    result.durationMs = Math.max(0, Date.now() - started);
    try { context.log?.({ provider: result.provider, sourceId: result.sourceId, source: result.source, runId: context.runId,
      status: result.status, recordsReceived: result.recordsReceived, normalized: result.jobs.length,
      warnings: result.warnings.reduce((count, warning) => count + warning.count, 0), durationMs: result.durationMs,
      errorKind: result.error?.kind, errorCode: result.error?.code }); } catch {}
    return result;
  }
}
