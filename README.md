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

## Public feature boundary

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
