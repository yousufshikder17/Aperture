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
- Optional AI-provider credentials for resume extraction and resource classification
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

## Guided resume builder

The `/builder` page supports creating and editing the complete master resume:
contact details, links, target roles, experience, projects, education, skills and
supporting evidence, certifications, publications, and awards. Save explicitly to
create a profile version. Failed saves retain the draft; failed profile loads
block editing instead of treating an unavailable profile as empty. Unsaved work
stays in memory, with navigation warnings, not browser storage.

The shared interface includes optional bullet-coaching controls, but hosted coaching
is not included in this public edition. An unavailable coaching endpoint does not
block manual editing or saving. References have their own editor and save action;
reference failures preserve the draft and do not alter the saved resume.
PDF/DOCX imports support extraction review, layout findings, explicit replacement,
and editing before saving. Extraction uses the configured AI provider; accepting
an import does not save automatically. Browser OIDC login is available at Account.
The API's
existing in-process recalculation queue and last-write-wins save behavior remain
unchanged; avoid concurrently editing the same resume in multiple tabs.

Run `npm test` and `npm run typecheck` from the repository root. The opt-in
`npm run test:browser -w @aperture/web` requires Chrome and `agent-browser` on the
machine (`AGENT_BROWSER_BIN` can specify its native executable). Stop the web dev
server first: the test starts its own Next.js instance on port 3109, overridable
with `BUILDER_TEST_PORT`, and uses a temporary loopback API with synthetic data.
It checks the real browser UI, not PostgreSQL persistence or a live AI provider.
Screenshots go to the ignored `apps/web/.next/builder-check` directory. Configure
browser OIDC login as described in the authentication guide. Development-token
fallback is disabled when an OIDC client is configured.

The browser regression uses a local OIDC provider fixture for login, session-backed
requests, account identity, and logout. It also covers imports, independent reference
saves, market errors/retry, score display, and cancelling navigation with unsaved edits.
Hosted coaching is treated as unavailable, matching this edition's actual API.

## Public feature boundary

Market suggestions and version history validate their response contracts. Listing
counts are JSON-safe numbers; version scores use the latest recorded snapshot.
Missing scores remain unavailable rather than being reported as zero.
The builder displays these market suggestions and score snapshots, including
pending values and genuine zero scores. Hosted master-resume audits, reference
assessments, and their UI controls are intentionally excluded.

- Resume/profile creation, import, versioning, and PDF export
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
