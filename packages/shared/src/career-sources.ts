import { z } from "zod";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const hostname = z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/);
export const CareerUrlSchema = z.string().max(2048).refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password &&
    (!url.port || url.port === "443") && !url.hash; } catch { return false; }
}, "Use an HTTPS URL without credentials, fragment, or custom port");
export const CompanySchema = z.object({
  id, name: z.string().trim().min(1).max(200), slug: id,
  careersUrl: CareerUrlSchema, enabled: z.boolean(), tags: z.array(z.string().min(1).max(40)).max(12),
}).strict();
export const GreenhouseSourceSchema = z.object({
  provider: z.literal("greenhouse").default("greenhouse"),
  id, companyId: id, boardToken: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/),
  enabled: z.boolean(), intervalHours: z.number().int().min(6).max(168),
  support: z.enum(["unvalidated", "supported", "manual-review-only", "unsupported"]),
  reason: z.string().max(1000).default(""),
}).strict().superRefine((source, ctx) => {
  if (source.enabled && source.support !== "supported")
    ctx.addIssue({ code: "custom", message: "Only reviewed Greenhouse sources may be enabled" });
});
export const LeverSourceSchema = z.object({
  provider: z.literal("lever"),
  id, companyId: id, site: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  region: z.enum(["global", "eu"]).default("global"),
  enabled: z.boolean(), intervalHours: z.number().int().min(6).max(168),
  support: z.enum(["unvalidated", "supported", "manual-review-only", "unsupported"]),
  reason: z.string().max(1000).default(""),
}).strict().superRefine((source, ctx) => {
  if (source.enabled && source.support !== "supported")
    ctx.addIssue({ code: "custom", message: "Only reviewed Lever sources may be enabled" });
});
export const AshbySourceSchema = z.object({
  provider: z.literal("ashby"),
  id, companyId: id, boardName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/),
  enabled: z.boolean(), intervalHours: z.number().int().min(6).max(168),
  support: z.enum(["unvalidated", "supported", "manual-review-only", "unsupported"]),
  reason: z.string().max(1000).default(""),
}).strict().superRefine((source, ctx) => {
  if (source.enabled && source.support !== "supported")
    ctx.addIssue({ code: "custom", message: "Only reviewed Ashby sources may be enabled" });
});
export const CompanyRegistrySchema = z.object({
  companies: z.array(CompanySchema).max(50),
  sources: z.array(z.discriminatedUnion("provider", [GreenhouseSourceSchema, LeverSourceSchema, AshbySourceSchema])).max(100),
}).strict().superRefine((registry, ctx) => {
  if (new Set(registry.companies.map(c => c.id)).size !== registry.companies.length ||
      new Set(registry.companies.map(c => c.slug)).size !== registry.companies.length ||
      new Set(registry.sources.map(s => s.id)).size !== registry.sources.length)
    ctx.addIssue({ code: "custom", message: "Duplicate registry identity" });
  const scopes = registry.sources.map(s => s.provider === "greenhouse" ? "greenhouse:" + s.boardToken.toLowerCase() :
    s.provider === "lever" ? "lever:" + s.region + "/" + s.site : "ashby:" + s.boardName);
  if (new Set(scopes).size !== scopes.length || registry.sources.some(s => !registry.companies.some(c => c.id === s.companyId)))
    ctx.addIssue({ code: "custom", message: "Duplicate board or unknown company" });
});
export type CompanyRegistry = z.infer<typeof CompanyRegistrySchema>;
export type GreenhouseSource = z.infer<typeof GreenhouseSourceSchema>;
export type LeverSource = z.infer<typeof LeverSourceSchema>;
export type AshbySource = z.infer<typeof AshbySourceSchema>;
export type RegisteredCareerSource = GreenhouseSource | LeverSource | AshbySource;
