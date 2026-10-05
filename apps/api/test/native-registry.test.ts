import assert from "node:assert/strict";
import test from "node:test";
import { CompanyRegistrySchema } from "@aperture/shared";
import { companyRegistry, registeredSourceConfig } from "../src/services/company-registry.js";
import { resolveCareerAdapter, resolveAdapter } from "../src/services/career-adapters.js";
import { careerScheduledJobs, scheduledJobs } from "../src/jobs/scheduler.js";
test("Public defaults are disabled synthetic examples, with central display/config resolution", () => {
  assert.equal(careerScheduledJobs(new Date()).length, 0);
  for (const source of companyRegistry.sources) {
    const {config, adapter} = resolveCareerAdapter(source.id);
    assert.equal(config.enabled, false); assert.equal(adapter.provider, source.provider);
    assert.match(adapter.displayUrl, /^https:\/\//);
    assert.throws(() => resolveAdapter("unsupported", config));
  }
});
test("native scheduler shares durable dispatch, intervals and company enablement", () => {
  const registry = CompanyRegistrySchema.parse(JSON.parse(JSON.stringify(companyRegistry)));
  registry.companies[0]!.enabled = true;
  registry.sources.forEach(s => { s.enabled=true; s.support="supported"; });
  const at = new Date("2026-10-05T12:00:00Z");
  const jobs = careerScheduledJobs(at, registry);
  assert.equal(jobs.length, 3); assert.deepEqual(jobs, careerScheduledJobs(at, registry));
  assert(jobs.every(j => j.kind === "career-ingest" && j.availableAt <= at));
  registry.sources[0]!.enabled=false; assert.equal(careerScheduledJobs(at,registry).length,2);
  registry.companies[0]!.enabled=false; assert.equal(careerScheduledJobs(at,registry).length,0);
  assert.equal(registeredSourceConfig(registry.sources[1]!.id,registry).enabled,false);
  assert(scheduledJobs(at).some(j => j.kind === "ingest"), "existing shared RSS schedule remains");
});
test("registry rejects credentials, arbitrary endpoints, duplicate scopes and unknown companies", () => {
  const source=companyRegistry.sources[0]!;
  for (const patch of [{companyId:"missing"},{url:"https://arbitrary.test"},{boardToken:"../path"},{apiKey:"secret"},{enabled:true}])
    assert.equal(CompanyRegistrySchema.safeParse({...companyRegistry,sources:[{...source,...patch}]}).success,false);
  assert.equal(CompanyRegistrySchema.safeParse({...companyRegistry,sources:[source,{...source,id:"another"}]}).success,false);
});
