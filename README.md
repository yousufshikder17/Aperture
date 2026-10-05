# Aperture

Aperture is a job-search and resume platform focused on structured resumes, transparent job matching, skill-gap analysis, and career-development workflows.

This public edition is a coherent application rather than a feature mock. It includes secure bearer-token authentication, user-owned profiles and application records, PDF/DOCX resume import, deterministic ATS-style keyword coverage, explainable job matching, market gap analytics, a curated learning-resource workflow, and a Next.js interface over a Hono API.

Advanced hosted analysis is outside this edition. Public endpoints return real deterministic results or are absent; there are no placeholder successes or hidden implementations.

## Architecture

| Workspace | Responsibility |
| --- | --- |
| `apps/api` | Hono API, verified authentication, ownership and admin boundaries, uploads, jobs, and routes |
| `apps/web` | Next.js interface and authenticated API client |
| `packages/shared` | Zod schemas and shared domain types |
| `packages/db` | Drizzle/Postgres schema and database client |
| `packages/ai` | Generic provider adapters, resume extraction, resource classification, and deterministic matching engines |
| `packages/analytics` | DuckDB queries for skill gaps, application response rates, and score history |

The API is the authorization boundary. The browser never selects an identity with custom headers. Every protected route receives one principal derived from a cryptographically verified OIDC/JWT credential, or an explicitly development-only bearer credential that cannot run in production.

## Requirements

- Node.js 20 or newer
- PostgreSQL for application data
- Optional AI-provider configuration for assisted resume import and resource classification; ordinary text imports need no AI
- DuckDB is embedded for local analytical queries

## Setup

```powershell
npm install
Copy-Item .env.example .env
npm run db:push
```

Replace the development token placeholders in `.env` with distinct random values. Start the API and web app in separate terminals:

```powershell
npm run dev:api
npm run dev:web
```

There is no root `npm run dev` because the API and web app are independent long-running processes; the explicit scripts make each process and its logs easy to control.

Production must use `AUTH_MODE=oidc` with issuer, audience, JWKS URL, and allowed algorithms configured. See [Authentication](docs/AUTHENTICATION.md).

## Public listing workflow

Use **Add a job posting** to paste a description or import TXT/DOCX/PDF, review the
draft, and save a posting visible only to your account. No feed or administrator
is required for manual entry. See [manual postings](docs/MANUAL_POSTINGS.md).

At `/listings`, refresh the latest 100 catalog entries or scan the operator-configured
RSS feeds (LinkedIn/Indeed labels, plus explicitly configured Jobicy). Scanning remains **administrator-only** because it updates
the shared catalog. Missing configuration, partial feed failures and duplicate entries
are distinguished; scanning does not automatically score matches. Native Greenhouse, Lever
and Ashby sources use the existing durable worker, separately from the RSS scan button.
The [native registry](resources/companies.json) contains disabled synthetic examples only;
see [configuration and read-only validation](docs/NATIVE_SOURCES.md). Provider support
does not establish permission to redistribute a company's jobs.

Open a listing to read its description and calculate a transparent match against your
saved master resume. Scoring is deterministic/local, respects the account allowance,
and saves the result with its resume version. Reload the detail page or listing index
to see saved results. Failed requests preserve displayed results and provide sign-in,
profile, quota and administrator recovery guidance. Listing actions never save or
replace your master resume.

This is a selective public port: no hosted recruiter intelligence, resume tailoring,
tailored-artifact storage/retrieval, or tailored-PDF controls/routes were added. The
existing lightweight `/ats` API remains unchanged. Public contract and regression tests
check the absent private routes, and browser tests assert that the interface never
calls them. The browser suite covers scanning states, match failures/retry/reload,
mobile layout and accessibility against synthetic services—not live feed/provider or
PostgreSQL acceptance. Browser captures are saved under ignored `exports/browser-check`.

## Background jobs

RSS imports now use a normalized source model and canonical reconciliation. Apply
`packages/db/migrations/003_listing_reconciliation.sql` when upgrading an existing
database. Source IDs and exact URLs preserve listing references while refreshing
content; RSS absence never implies closure. See [native lifecycle and migration
details](docs/NATIVE_SOURCES.md).

Apply `packages/db/migrations/004_source_health.sql` for native scan diagnostics.
Apply `packages/db/migrations/002_background_jobs.sql`, then set
`BACKGROUND_JOBS_ENABLED=true` on the persistent API instance owning the DuckDB file.
Profile saves and recalculation jobs commit atomically. The worker retries failures
and schedules shared-feed ingestion, resource sync, transactional analytics refreshes
and explicitly opted-in digest email. See [operations](docs/BACKGROUND_JOBS.md).

## Resource archive

Save resources from `/resources`, then open **My resource archive** to edit notes
and set Not started, In progress, or Completed. Changes are saved explicitly;
failures retain your edits and offer retry. The directory shows existing saves,
and duplicate saves resolve to the existing archive entry.

The existing save allowance applies to new saves. Updating notes or progress on
an existing entry does not spend that allowance. Completion records your progress;
it does not automatically add skills to your resume or unlock prerequisites.
No database migration is required. See [archive verification](docs/RESOURCE_ARCHIVE.md).

## Application tracker

Every authenticated public account can log a catalog listing at `/applications`
or follow **Track application** from a listing. The tracker supports status changes,
editable/clearable notes, and status history. Failed saves retain edits for retry.
Job titles and companies remain visible after entries leave the latest catalog page.
Feed scanning remains administrator-only; tracking does not submit applications to employers.
No database migration or paid-plan gate is introduced by this port.

See [tracker verification](docs/APPLICATION_TRACKER.md) for unit, route integration,
PostgreSQL concurrency, browser, and accessibility checks.

## Guided resume builder

The `/builder` page supports creating and editing the complete master resume:
contact details, links, target roles, experience, projects, education, skills and
supporting evidence, certifications, publications, and awards. Save explicitly to
create a profile version. Failed saves retain the draft; failed profile loads
block editing instead of treating an unavailable profile as empty. Unsaved work
stays in memory, with navigation warnings, not browser storage.

Section links and writing prompts guide the form. **Review current draft** checks
required fields and shows the current content before saving; another edit clears
that review. **Download saved resume PDF** becomes available after saving, checks
the returned file, and offers retry on failure. Review and download create no
extra resume versions.

Experience and project bullets are edited manually. Hosted bullet coaching is
outside this public edition, so the builder has no coaching control. References
have their own editor and save action;
reference failures preserve the draft and do not alter the saved resume.
PDF/DOCX imports support extraction review, layout findings, explicit replacement,
and editing before saving. Extraction defaults to deterministic text parsing; optional AI uses FAST_PROVIDER. See [import modes](docs/RESUME_IMPORT.md). Accepting
an import does not save automatically. Browser OIDC login is available at Account.
Recalculation jobs are durable and commit with the saved profile. Last-write-wins
save behavior remains; avoid concurrently editing the same resume in multiple tabs.

Run `npm test` and `npm run typecheck` from the repository root. The opt-in
`npm run test:browser -w @aperture/web` requires Chrome and `agent-browser` on the
machine (`AGENT_BROWSER_BIN` can specify its native executable). The test uses an isolated
Next build cache and starts its own instance on port 3109 (override with `BUILDER_TEST_PORT`).
Keep the chosen port free. It uses a temporary loopback API with synthetic data.
It checks the real browser UI, not PostgreSQL persistence or a live AI provider.
Screenshots go to the ignored `exports/browser-check` directory. Configure
browser OIDC login as described in the authentication guide. Development-token
fallback is disabled when an OIDC client is configured.

The browser regression uses a local OIDC provider fixture for login, session-backed
requests, account identity, and logout. It also covers imports, independent reference
saves, market errors/retry, score display, and cancelling navigation with unsaved edits.
The regression also checks from-scratch creation, draft review, PDF retry, mobile
layout, and that the builder makes no hosted coaching request.

## Resume templates

The `/templates` page searches the curated, repository-hosted
[`resources/templates.json`](./resources/templates.json) catalog by style, role,
layout, or ATS compatibility. Choose a design, adjust its type, colors, spacing,
section order, and sidebar, then preview it with your saved master resume before
saving. Two-column designs carry an ATS reading-order warning. The choice is
stored separately from resume content and changes only future master-resume PDF
downloads; without a choice, the clean ATS-safe design remains the default.

The public edition offers manual customization but no template-upload or PDF
vision extraction route. Catalog additions are reviewed as JSON changes in the
repository. Run `npm run db:push` after updating to add the profile's `template`
column. The browser regression uses synthetic API responses; live PostgreSQL
persistence remains a deployment check.

## Public feature boundary

Market suggestions and version history validate their response contracts. Listing
counts are JSON-safe numbers; version scores use the latest recorded snapshot.
Missing scores remain unavailable rather than being reported as zero.
The builder displays these market suggestions and score snapshots, including
pending values and genuine zero scores. Hosted master-resume audits, reference
assessments, and their UI controls are intentionally excluded.

- Resume/profile creation, import, versioning, and PDF export
- Curated resume templates, manual styling, preview, and saved master-PDF selection
- Job ingestion, listing storage, and application tracking
- Deterministic matching with published weights: skills 45%, experience 25%, seniority 20%, location 10%
- ATS-style keyword coverage and lightweight missing-skill analysis
- Learning-resource directory, archive, and prerequisite guidance
- Basic response-rate and score-trajectory analytics
- Stable free, premium, and admin development identities for boundary testing
- 8 MiB server-side resume upload limit by default
- Admin-only shared catalog and resource synchronization

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

No license is declared in this repository.

## Live gaps and resource filters

Gap analysis at `/gap-analysis` and builder market suggestions share a deterministic
calculation over the signed-in user's scored listings and current saved resume.
Each percentage uses the listing count for that role; no analytics refresh is
needed for these two views. Other analytics still use the ETL job.

Resources can be filtered by beginner, intermediate, or advanced level while
retaining the skill filter. Feed ingestion remains administrator-only over the
shared catalog; response bodies are limited to 2 MiB. No feed cache, personalized
scan, hosted analysis, or listing-discovery migration is introduced by this port.

Development commands load the root `.env` cross-platform; shell exports and workspace
.env copies are unnecessary. Existing process values win; restart after edits.
Production starts/builds retain deployment environment values.
