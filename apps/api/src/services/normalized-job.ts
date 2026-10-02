import { z } from "zod";
import { ListingSourceSchema } from "@aperture/shared";

const webUrl = z.string().trim().min(1).max(2048).refine(value => {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}, "Expected an HTTP(S) URL without credentials");

// Internal adapter contract, not a user-facing API. Manual drafts retain owner-scoped persistence.
export const NormalizedJobSchema = z.object({
  source: ListingSourceSchema.exclude(["manual"]),
  namespace: z.string().trim().min(1).max(200).refine(value => value !== "legacy"),
  externalId: z.string().trim().min(1).max(1000).nullable(),
  url: webUrl,
  title: z.string().trim().min(1).max(1000),
  company: z.string().trim().min(1).max(1000),
  description: z.string().max(2 * 1024 * 1024),
  location: z.string().max(1000).nullable(),
  salary: z.string().max(1000).nullable(),
  postedAt: z.date().nullable(),
  sourceUpdatedAt: z.date().nullable(),
  observedAt: z.date(),
  availability: z.enum(["open", "closed", "unknown"]),
  raw: z.record(z.string(), z.unknown()).nullable(),
}).strict();

export type NormalizedJob = z.infer<typeof NormalizedJobSchema>;
export function sourceIdentity(job: NormalizedJob) {
  return job.externalId === null ? `url:${job.url}` : `id:${job.externalId}`;
}

// Exact validated URLs only: query parameters, fragments, schemes and path case may identify different jobs.
// No fuzzy title/company matching and no tracking-parameter stripping without a provider-specific guarantee.
export function canonicalAvailability(states: NormalizedJob["availability"][]): NormalizedJob["availability"] {
  if (states.includes("open")) return "open";
  if (!states.length || states.includes("unknown")) return "unknown";
  return "closed";
}
