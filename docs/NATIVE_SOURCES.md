# Public native source adapters
Greenhouse, Lever and Ashby are read-only public API adapters selected centrally.
The native registry contains disabled synthetic examples only; no curated company inventory is activated.
Configure company linkage, provider board/site identifier, reviewed support, enabled state and interval (6–168 hours).

Endpoints: Greenhouse boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true;
Lever api.lever.co (or api.eu.lever.co)/v0/postings/{site}?mode=json&skip={offset}&limit=100;
Ashby api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true.
Lever consumes pages through the terminal empty response; Ashby excludes isListed=false.
Namespaces are provider-qualified; IDs are Greenhouse ID, Lever ID, or Ashby's supplied stable job URL.
Duplicate/conflicting identities are withheld. Malformed, partial or failed scans never authorize closure.
Complete snapshots, including empty boards, close only absent representations in their scope;
another open representation keeps a canonical listing open and application records remain unchanged.
Listing/application provenance is retained; descriptions are sanitized once and richer metadata stays raw.

The existing durable worker schedules approved enabled boards when BACKGROUND_JOBS_ENABLED=true.
Health uses source_health, independent of retry savepoints; retries belong to the durable queue.
Apply migration 004_source_health.sql to existing databases. No scraping, submission, credentials,
review subsystem or source-management UI is included.

Use npm run sources:validate -w @aperture/api -- <source-id> [registry-json-path] for read-only checks.
Activation overrides are in-memory only; no listing, health or tracker writes occur.
Technical support does not establish source-use or redistribution rights. Approve sources separately.
Normal tests are synthetic; PostgreSQL tests require a disposable TEST_DATABASE_URL.

## Verification and release limits

Run npm test, npm run typecheck, npm run build, and
npm run test:browser -w @aperture/web. The browser fixture uses an isolated Next
cache and synthetic OIDC/API responses, covering shared scans, tracking, manual
ownership, review-before-save, optional import AI, and absent Private controls.
The API includes provider fixtures, transport bounds, namespace isolation,
duplicate handling, Lever pagination, Ashby visibility, worker and health checks.
PostgreSQL tests additionally cover scoped empty closure, alternate observations,
application URL updates, intact applications and the new health migration.

The selective port passes deterministic and browser checks. PostgreSQL acceptance
was not executed because TEST_DATABASE_URL was unavailable; configure a disposable
database and rerun before deployment. Existing production databases need migration
004 in addition to 002/003. Review dependency audit findings and approve any real
source inventory separately. No source is enabled and no live jobs are persisted
by this port. Technical readiness is separate from deployment/source-use approval.
