import { readFileSync } from "node:fs";
import { CompanyRegistrySchema, type CompanyRegistry, type RegisteredCareerSource } from "@aperture/shared";
import type { JobSourceConfig } from "./job-source.js";

// Reviewed, version-controlled configuration is the only source of fetch destinations.
export const companyRegistry = CompanyRegistrySchema.parse(JSON.parse(readFileSync(
  new URL("../../../../resources/companies.json", import.meta.url), "utf8",
)));
export function registeredSourceConfig(sourceId: string, registry: CompanyRegistry = companyRegistry): JobSourceConfig<RegisteredCareerSource> {
  const source = registry.sources.find(item => item.id === sourceId);
  const company = registry.companies.find(item => item.id === source?.companyId);
  if (!source || !company) throw new Error("UnknownCareerSource");
  return { provider: source.provider, sourceId: source.id, source: "career_page",
    enabled: source.enabled && company.enabled, config: source };
}
