# Resource archive

The Resources directory keeps its skill and level filters and adds a save action.
`/resources/archive` lists the signed-in user's saved resources, newest first,
with editable notes and three progress states. Notes can be cleared; unchanged
forms cannot be submitted. Navigation warns about unsaved edits.

## API

- `GET /v1/resources/archive`: owned entries with resource metadata.
- `POST /v1/resources/archive`: resource ID and optional notes; returns 201.
- `PATCH /v1/resources/archive/:id`: progress, notes, or both.
- Invalid/empty changes return 400; missing or unowned entries return 404.
- Duplicate saves return 409 before quota is spent when already present at validation.
- Exhausted new-save allowance returns 402. Existing entries remain editable.
- Notes allow up to 10,000 characters. An empty string clears them.

The existing unique user/resource constraint prevents duplicate entries, including
concurrent requests. Quota reservation still precedes insertion; simultaneous saves
of the same resource may reserve quota before one loses the insert race.
Completion is self-reported and does not change resume skills or prerequisites.

## Verification

`npm test` runs contract, API integration, and UI regression checks. Set
`TEST_DATABASE_URL` to a disposable PostgreSQL database to include persistence,
ownership, duplicate constraints, and independent concurrent notes/progress edits.
Each database test creates and removes its own randomly named schema.

`npm run test:browser -w @aperture/web` includes save failures/retry, quota errors,
duplicate saves, archive load failures, notes clearing, progress changes, reload,
authentication errors, mobile layout, and accessibility. It uses synthetic API
responses with the existing browser authentication fixture. Set
`ARCHIVE_BROWSER_ONLY=1` for a focused archive run through the same harness.
Screenshots go to ignored `exports/browser-check`. Chrome and agent-browser are
required; stop the web development server before running the browser suite.
