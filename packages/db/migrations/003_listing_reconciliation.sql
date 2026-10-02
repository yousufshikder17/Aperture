BEGIN;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'unknown';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS last_seen_at timestamp;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS last_changed_at timestamp;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS closed_at timestamp;
-- created_at remains the canonical first-seen timestamp. Never infer historical closure.
UPDATE listings SET last_seen_at = COALESCE(last_seen_at, created_at, now()),
  last_changed_at = COALESCE(last_changed_at, created_at, now())
WHERE last_seen_at IS NULL OR last_changed_at IS NULL;
ALTER TABLE listings ALTER COLUMN last_seen_at SET DEFAULT now(), ALTER COLUMN last_seen_at SET NOT NULL;
ALTER TABLE listings ALTER COLUMN last_changed_at SET DEFAULT now(), ALTER COLUMN last_changed_at SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'listings'::regclass AND conname = 'listings_availability_check') THEN
    ALTER TABLE listings ADD CONSTRAINT listings_availability_check CHECK (availability IN ('open','closed','unknown'));
    ALTER TABLE listings ADD CONSTRAINT listings_closed_at_check CHECK ((availability = 'closed') = (closed_at IS NOT NULL));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS listing_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id),
  source text NOT NULL CONSTRAINT listing_sources_not_manual_check CHECK (source <> 'manual'),
  namespace text NOT NULL,
  identity_key text NOT NULL,
  external_id text,
  url text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  availability text NOT NULL DEFAULT 'unknown' CONSTRAINT listing_sources_availability_check CHECK (availability IN ('open','closed','unknown')),
  snapshot jsonb NOT NULL DEFAULT '{}',
  source_updated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS listing_sources_identity_idx ON listing_sources(source, namespace, identity_key);
CREATE UNIQUE INDEX IF NOT EXISTS listing_sources_primary_idx ON listing_sources(listing_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS listing_sources_url_idx ON listing_sources(url);
CREATE INDEX IF NOT EXISTS listing_sources_listing_idx ON listing_sources(listing_id);
-- URLs are the only trustworthy legacy identity. Do not invent RSS GUIDs or merge rows.
INSERT INTO listing_sources (listing_id, source, namespace, identity_key, url, is_primary, created_at, last_seen_at)
SELECT l.id, l.source, 'legacy', 'url:' || l.url, l.url, true, l.created_at, l.last_seen_at
FROM listings l WHERE l.source <> 'manual'
  AND NOT EXISTS (SELECT 1 FROM listing_sources s WHERE s.listing_id = l.id)
ON CONFLICT DO NOTHING;
COMMIT;
