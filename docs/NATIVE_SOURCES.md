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
