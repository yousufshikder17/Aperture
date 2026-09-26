# Application tracker verification

## API contract

All routes require authentication. Public tracking is available to every authenticated account, including the free tier.

- `GET /v1/applications` returns only the principal's records, newest first, with job titles and companies.
- `POST /v1/applications` accepts a catalog `listingId`, status (default `saved`), and optional notes.
- `PATCH /v1/applications/:id` accepts status, notes, or both. An empty notes string clears notes.
- Notes are limited to 10,000 characters. Invalid IDs, statuses, and empty patches return 400.
- Missing listings or applications, including another user's application, return 404.
- Unauthenticated requests return 401. There is no private-edition plan gate.

Status changes append history. Notes-only edits and unchanged statuses do not.
The first applied/screening/interviewing/offer status sets the recorded application
date; later changes preserve it. Updates lock the owned row in a transaction so
concurrent status and notes changes do not discard each other's history.

## Automated checks

Run `npm test` and `npm run typecheck` for unit, route integration, rendering,
contract, and existing regression coverage.

For real PostgreSQL persistence and concurrent updates, use a disposable test
database. The test creates a randomly named schema and removes only that schema:

```powershell
$env:TEST_DATABASE_URL = 'postgres://postgres@127.0.0.1:55439/postgres'
npm run test -w @aperture/api
Remove-Item Env:TEST_DATABASE_URL
```

Run `npm run test:browser -w @aperture/web` with Chrome and agent-browser installed.
Stop the web development server first. This existing suite runs a temporary
Next.js server and synthetic authenticated API, including tracker load/create/edit
failures, retry, notes clearing, persistence after reload, authentication errors and older catalog listing links,
desktop/mobile screenshots, and accessibility checks. It does not contact real
employers or AI providers. Captures are under ignored `exports/browser-check`.

Set `TRACKER_BROWSER_ONLY=1` to run only authentication setup and the tracker
browser cases through the same harness, without repeating builder/template checks.
