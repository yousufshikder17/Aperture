# Manual job postings

Open **Listings → Add a job posting**, enter title, company and description, then
choose **Save posting**. Location, salary and the original posting URL are optional.
The URL is a link only; Aperture does not crawl it. Saved postings work with the
existing deterministic match, lightweight ATS and application-tracking flows.
Matching retains its profile requirement and quota; tracker access remains available
to every authenticated public account. Hosted intelligence and tailoring stay absent.

You can also import UTF-8 TXT, DOCX or PDF files up to 4 MiB. TXT and DOCX are
extracted locally without AI. PDFs are limited to five pages and use the fast AI
provider plus one match allowance; invalid/oversized PDFs are rejected before
quota reservation. Failed provider calls may still consume the reserved allowance.
Import returns an unsaved draft: review it, choose **Use imported draft**, correct
the fields, then save. Nothing is added to the master resume.

Drafts remain in memory with navigation warnings. Failed imports do not replace
the description. Failed saves retain the form and its retry key. A repeated save
with the same key and content returns the same posting; changing an already-saved
retry payload returns 409 so the UI can direct the user to review existing listings.
Clearing the form explicitly starts a new posting.

## Privacy and storage

`POST /v1/listings/manual` validates the shared create schema, including an explicit
request UUID. The API supplies the owner from the authenticated principal, never
from the request body. The internal unique URL includes the owner and retry key;
the optional original URL is stored separately in `raw.originalUrl`.

Manual listings carry `raw.ownerId`. Catalog/detail reads, matching, ATS checks and
tracker creation check it. Shared feed entries remain visible to authenticated users. Two users may save the same external URL without sharing or
overwriting either user's content. No listing-discovery table or migration is needed
in the public edition. Legacy manual rows without an owner are not exposed;
an operator must verify ownership before assigning it.

`POST /v1/listings/import` accepts multipart field `file` and returns the editable
draft. It never persists an entry. Uploaded originals are not retained.

## Verification

`npm test` and `npm run typecheck` cover contracts and UI rendering.
Set `TEST_DATABASE_URL` to a disposable PostgreSQL database for concurrent retry,
same-URL isolation, unauthorized catalog/detail/match/ATS access and tracker checks.

Run `MANUAL_POSTING_BROWSER_ONLY=1 npm run test:browser -w @aperture/web`
for the focused browser flow: save failure/retry, import failure/review, explicit
draft application, reload persistence, mobile overflow and accessibility.
Browser services and AI outputs are synthetic. Real TXT/DOCX extraction is covered
by API tests; live PDF transcription remains a deployment acceptance check.
