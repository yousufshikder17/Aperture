import { readFileSync } from "node:fs";
import { CompanyRegistrySchema } from "@aperture/shared";
import { companyRegistry } from "../services/company-registry.js";
import { resolveCareerAdapter } from "../services/career-adapters.js";

const sourceId = process.argv[2];
const registryPath = process.argv[3];
if (!sourceId) throw new Error("Usage: npm run sources:validate -w @aperture/api -- <source-id> [registry-json-path]");
const registry = registryPath ? CompanyRegistrySchema.parse(JSON.parse(readFileSync(registryPath, "utf8"))) : structuredClone(companyRegistry);
const source = registry.sources.find(source => source.id === sourceId);
const company = registry.companies.find(company => company.id === source?.companyId);
if (!source || !company) throw new Error("UnknownCareerSource");
// This command authorizes only a read-only check. These activation overrides are never persisted.
source.enabled = true; source.support = "supported"; company.enabled = true;
const { adapter } = resolveCareerAdapter(sourceId, registry);
const result = await adapter.fetch({ log: () => {} });
console.info(JSON.stringify({ provider: result.provider, sourceId: result.sourceId, status: result.status,
  snapshotComplete: result.snapshotComplete, snapshotNamespace: result.snapshotNamespace,
  recordsReceived: result.recordsReceived, normalized: result.jobs.length, warnings: result.warnings,
  error: result.status === "failure" ? result.error : undefined,
  examples: result.jobs.slice(0, 3).map(({ title, company, location, url, applicationUrl, employmentType, salary, description }) =>
    ({ title, company, location, url, applicationUrl, employmentType, salary, description: description.slice(0, 600) })) }, null, 2));
if (result.status === "failure") process.exitCode = result.error.retryable ? 2 : 1;
