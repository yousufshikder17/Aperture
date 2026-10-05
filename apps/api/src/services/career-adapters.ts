import { companyRegistry, registeredSourceConfig } from "./company-registry.js";
import type { AshbySource, CompanyRegistry, GreenhouseSource, LeverSource, RegisteredCareerSource } from "@aperture/shared";
import { AshbyJobSourceAdapter, ashbyEndpoint } from "./ashby-source.js";
import { GreenhouseJobSourceAdapter, greenhouseEndpoint } from "./greenhouse-source.js";
import { LeverJobSourceAdapter, leverEndpoint } from "./lever-source.js";
import type { JobSourceConfig } from "./job-source.js";
import type { JobSourceContext, JobSourceFetchResult } from "./job-source.js";

export function resolveAdapter(provider: string, source: JobSourceConfig<RegisteredCareerSource>,
  registry: CompanyRegistry = companyRegistry): { provider: string; displayUrl: string; fetch(context?: JobSourceContext): Promise<JobSourceFetchResult> } {
  if (provider === "greenhouse" && source.provider === provider && source.config.provider === provider) {
    const config: JobSourceConfig<GreenhouseSource> = { ...source, config: source.config };
    return { provider, displayUrl: greenhouseEndpoint(config.config.boardToken), fetch: context => new GreenhouseJobSourceAdapter(registry).fetch(config, context) };
  }

  if (provider === "lever" && source.provider === provider && source.config.provider === provider) {
    const config: JobSourceConfig<LeverSource> = { ...source, config: source.config };
    return { provider, displayUrl: leverEndpoint(config.config.site, config.config.region),
      fetch: context => new LeverJobSourceAdapter(registry).fetch(config, context) };
  }
  if (provider === "ashby" && source.provider === provider && source.config.provider === provider) {
    const config: JobSourceConfig<AshbySource> = { ...source, config: source.config };
    return { provider, displayUrl: ashbyEndpoint(config.config.boardName),
      fetch: context => new AshbyJobSourceAdapter(registry).fetch(config, context) };
  }
  throw new Error("UnsupportedJobSourceProvider");
}

export function resolveCareerAdapter(sourceId: string, registry: CompanyRegistry = companyRegistry) {
  const config = registeredSourceConfig(sourceId, registry);
  return { config, adapter: resolveAdapter(config.provider, config, registry) };
}
