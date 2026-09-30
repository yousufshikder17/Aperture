# Background jobs

Apply `packages/db/migrations/002_background_jobs.sql` before deploying the API,
or use `npm run db:push` for a new database. Profile content, version history and
the recalculation job commit in one PostgreSQL transaction. A failed enqueue fails
the save, so the UI retains the draft for retry.

Jobs are processed serially per database under a PostgreSQL transaction advisory
lock. Disconnects release the lock and roll back unfinished work. Handler database
writes made through the job transaction use a savepoint; failures roll them back and record a retry with exponential
backoff (30 seconds initially), up to five attempts. External calls may run again
after a crash; this is at-least-once execution, not exactly-once AI billing.
Feed and registry upserts commit independently and are safe to repeat on retry.

Inspect unfinished jobs with:

```sql
SELECT id, kind, attempts, available_at, last_error
FROM background_jobs WHERE completed_at IS NULL ORDER BY available_at;
```

After fixing the cause, retry an exhausted job deliberately:

```sql
UPDATE background_jobs SET attempts = 0, available_at = now(), last_error = NULL
WHERE id = 'the-specific-job-id' AND completed_at IS NULL;
```

Completed rows are retained as deduplication records. Error records contain only
the error class, not provider responses or private career data.

Run `TEST_DATABASE_URL=<disposable-postgres-url> npm test -w @aperture/api`
to verify rollback, concurrent workers, connection-loss recovery and retry limits.
The test creates and removes its own isolated schema.
The same API suite verifies failed ETL rollback against a real in-memory DuckDB,
followed by a successful refresh visible through the existing reader connection.

## Running and scheduling

Set `BACKGROUND_JOBS_ENABLED=true` on the persistent API instance and restart it.
The worker runs inside that process, so DuckDB readers and the ETL writer share
one DuckDB instance. Do not run multiple API processes against the same DuckDB file.
ETL uses its own connection and transaction; readers keep the previous snapshot
until a complete refresh commits. No separate Redis service or cron daemon is needed.

The scheduler uses PostgreSQL time and checks once per minute:

| Work | Schedule (UTC) |
| --- | --- |
| Ingest profile-targeted feeds | Hourly; a separate durable job per profile |
| Refresh analytics | Hourly |
| Sync resources | Daily, from 06:00 |
| Prepare and deliver digests | Daily, from 08:00 |

Unique period keys prevent duplicate scheduling across restarts. On startup,
the current eligible periods are scheduled; missed historical periods are not
replayed. Already queued jobs survive downtime. ETL and digests reflect committed
data when they run, and do not wait for every ingest job. Ingestion discovers jobs;
it does not spend users' paid match allowances or automatically score new listings.

For email, configure `RESEND_API_KEY`, a verified `DIGEST_FROM`, and
`DIGEST_USER_IDS` with only the UUIDs of users who requested digests. An empty list
disables delivery; development identities are excluded. Removing a UUID stops
queued messages as well. A self-service subscription UI is not included.
No email is sent just by running migrations or tests.

Each message is frozen in a durable delivery job before sending through the
[Resend email API](https://resend.com/docs/api-reference/emails/send-email).
Retries use its [idempotency key](https://resend.com/docs/dashboard/emails/idempotency-keys).
Delivery jobs older than 23 hours fail closed before the provider's 24-hour
deduplication window expires; do not recreate an expired message under a new key
without checking delivery history. Empty digests are skipped.
Digest job payloads contain recipient addresses and matched job text; restrict
database access as for the rest of the user's career data.
