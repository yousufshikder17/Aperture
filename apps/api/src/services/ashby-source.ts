import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { AshbySourceSchema, CareerUrlSchema, type AshbySource, type CompanyRegistry } from "@aperture/shared";
import { careerText } from "./career-text.js";
import { CareerFetchError, createCareerReader, type CareerReader } from "./career-http.js";
import type { JobSourceAdapter, JobSourceConfig, JobSourceContext, JobSourceError, JobSourceFetchResult } from "./job-source.js";
import { NormalizedJobSchema, providerNamespace } from "./normalized-job.js";

const text = z.string().nullable().optional();
const postal = z.object({ addressLocality: text, addressRegion: text, addressCountry: text }).passthrough();
const component = z.object({ compensationType: z.string(), interval: text, currencyCode: text,
  minValue: z.number().finite().nullable().optional(), maxValue: z.number().finite().nullable().optional(), summary: text }).passthrough();
const posting = z.object({
  title: z.string().trim().min(1), jobUrl: z.string(), applyUrl: text, isListed: z.boolean(),
  location: text, secondaryLocations: z.array(z.object({ location: text, address: postal.nullable().optional() })).nullable().optional(),
  department: text, team: text, isRemote: z.boolean().nullable().optional(),
  workplaceType: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,99}$/).nullable().optional(),
  employmentType: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,99}$/).nullable().optional(),
  descriptionHtml: text, descriptionPlain: text, publishedAt: text,
  address: z.object({ postalAddress: postal.nullable().optional() }).passthrough().nullable().optional(),
  compensation: z.object({ compensationTierSummary: text, scrapeableCompensationSalarySummary: text,
    summaryComponents: z.array(component).nullable().optional(),
    compensationTiers: z.array(z.object({ components: z.array(component).optional() }).passthrough()).nullable().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();
const employmentTypes = ["FullTime", "PartTime", "Intern", "Contract", "Temporary"];
const currencies = new Set(Intl.supportedValuesOf("currency"));
const intervals: Record<string, string> = { "1 YEAR": "year", "1 MONTH": "month", "1 WEEK": "week", "1 DAY": "day", "1 HOUR": "hour" };

export function ashbyEndpoint(boardName: string) {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardName)}?includeCompensation=true`;
}
function jobUrl(value: string, boardName: string) {
  if (!CareerUrlSchema.safeParse(value).success) return null;
  const url = new URL(value);
  const parts = url.pathname.split("/");
  return url.hostname === "jobs.ashbyhq.com" && !url.search && parts.length === 3 && parts[1] === boardName &&
    /^[A-Za-z0-9_-]+$/.test(parts[2]!) ? url.href : null;
}
function salary(item: z.infer<typeof posting>) {
  const salaries = item.compensation?.summaryComponents?.filter(component => component.compensationType === "Salary") ?? [];
  if (salaries.length !== 1) return null;
  const range = salaries[0]!;
  if (!range.currencyCode || !currencies.has(range.currencyCode) || !range.interval || !intervals[range.interval] ||
      range.minValue == null || range.maxValue == null || range.minValue < 0 || range.minValue > range.maxValue) return null;
  return `${range.currencyCode} ${range.minValue === range.maxValue ? range.minValue : `${range.minValue}–${range.maxValue}`} / ${intervals[range.interval]}`;
}
export function normalizeAshbyJob(value: unknown, source: JobSourceConfig<AshbySource>, company: string, observedAt: Date) {
  const parsed = posting.safeParse(value);
  if (!parsed.success || !parsed.data.isListed) return null;
  const item = parsed.data, url = jobUrl(item.jobUrl, source.config.boardName);
  if (!url || item.applyUrl && (!CareerUrlSchema.safeParse(item.applyUrl).success ||
      new URL(item.applyUrl).origin !== new URL(url).origin || new URL(item.applyUrl).pathname !== `${new URL(url).pathname}/application`)) return null;
  const publishedAt = item.publishedAt && z.iso.datetime({ offset: true }).safeParse(item.publishedAt).success ? new Date(item.publishedAt) : null;
  const plain = item.descriptionPlain?.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const normalized = NormalizedJobSchema.safeParse({ source: source.source,
    namespace: providerNamespace("ashby", source.config.boardName), externalId: null,
    url, sourceUrl: url, canonicalUrl: url, ...(item.applyUrl ? { applicationUrl: item.applyUrl } : {}),
    title: item.title, company, location: item.location || null,
    description: careerText(item.descriptionHtml || plain || ""),
    employmentType: item.employmentType && employmentTypes.includes(item.employmentType) ? item.employmentType : null,
    salary: salary(item), postedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    sourceUpdatedAt: null, observedAt, availability: "open",
    raw: Object.fromEntries(["id", "location", "secondaryLocations", "department", "team", "isListed", "isRemote",
      "workplaceType", "employmentType", "address", "publishedAt", "compensation"].filter(key => item[key] !== undefined).map(key => [key, item[key]])),
  });
  return normalized.success ? normalized.data : null;
}

export class AshbyJobSourceAdapter implements JobSourceAdapter<AshbySource> {
  readonly provider = "ashby";
  constructor(private readonly registry: CompanyRegistry, private readonly read: CareerReader = createCareerReader({ maxBytes: 16 * 1024 * 1024 })) {}

  async fetch(input: JobSourceConfig<AshbySource>, context: JobSourceContext = {}): Promise<JobSourceFetchResult> {
    const started = Date.now(), fetchedAt = (context.now ?? (() => new Date()))();
    const metadata = { provider: this.provider, sourceId: input.sourceId, source: input.source, fetchedAt, durationMs: 0, recordsReceived: 0 };
    let result: JobSourceFetchResult;
    try {
      const parsed = AshbySourceSchema.safeParse(input.config);
      const approved = parsed.success && this.registry.sources.find((source): source is AshbySource => source.provider === this.provider && source.id === parsed.data.id);
      const company = this.registry.companies.find(company => company.id === input.config?.companyId);
      if (!parsed.success || input.provider !== this.provider || input.source !== "career_page" || !input.enabled || !parsed.data.enabled ||
          input.sourceId !== parsed.data.id || !company?.enabled || !approved || !approved.enabled || approved.support !== "supported" ||
          approved.companyId !== parsed.data.companyId || approved.boardName !== parsed.data.boardName ||
          context.timeoutMs !== undefined && (!Number.isInteger(context.timeoutMs) || context.timeoutMs < 1 || context.timeoutMs > 30_000))
        throw new CareerFetchError("configuration", "invalid_or_disabled_source");
      const endpoint = ashbyEndpoint(parsed.data.boardName);
      const response = await this.read({ url: endpoint, expectedHostname: "api.ashbyhq.com", redirectHosts: [] }, endpoint, context);
      if (response.contentType !== "application/json") throw new CareerFetchError("payload", "unexpected_content_type");
      let payload: unknown;
      try { payload = JSON.parse(response.body) as unknown; } catch { throw new CareerFetchError("payload", "malformed_json"); }
      const board = z.object({ apiVersion: z.literal("1"), jobs: z.array(z.unknown()) }).safeParse(payload);
      if (!board.success) throw new CareerFetchError("payload", "invalid_board_payload");
      metadata.recordsReceived = board.data.jobs.length;
      const identities = new Map<string, unknown[]>();
      for (const value of board.data.jobs) if (value && typeof value === "object" && "jobUrl" in value && typeof value.jobUrl === "string") {
        const url = jobUrl(value.jobUrl, parsed.data.boardName);
        if (url) { const records = identities.get(url) ?? []; records.push(value); identities.set(url, records); }
      }
      const duplicates = [...identities.values()].filter(records => records.length > 1);
      const conflicting = duplicates.filter(records => records.some(value => !isDeepStrictEqual(value, records[0])));
      let rejected = 0, invalidDates = 0;
      const jobs = board.data.jobs.flatMap(value => {
        const record = posting.safeParse(value);
        if (!record.success || !jobUrl(record.data.jobUrl, parsed.data.boardName)) { rejected++; return []; }
        if (!record.data.isListed) return [];
        const job = normalizeAshbyJob(value, input, company.name, fetchedAt);
        if (!job) { rejected++; return []; }
        if (record.data.publishedAt && job.postedAt === null) invalidDates++;
        return identities.get(job.url)?.length === 1 ? [job] : [];
      });
      const warnings = [ ...(rejected ? [{ code: "invalid_record", count: rejected }] : []),
        ...(invalidDates ? [{ code: "invalid_published_at", count: invalidDates }] : []),
        ...(duplicates.length ? [{ code: "duplicate_job_identity", count: duplicates.length }] : []),
        ...(conflicting.length ? [{ code: "conflicting_job_identity", count: conflicting.length }] : []) ];
      result = warnings.length ? { ...metadata, status: "partial", snapshotComplete: false, jobs, warnings } :
        { ...metadata, status: "success", snapshotComplete: true, snapshotNamespace: providerNamespace(this.provider, parsed.data.boardName), jobs, warnings: [] };
    } catch (error) {
      const failure: JobSourceError = error instanceof CareerFetchError ? { kind: error.kind, code: error.code, retryable: error.retryable } :
        { kind: "source", code: context.signal?.aborted ? "request_cancelled" :
          error instanceof Error && (error.name === "TimeoutError" || error.cause instanceof Error && error.cause.name === "TimeoutError") ?
            "request_timeout" : "network_failure", retryable: !context.signal?.aborted };
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
