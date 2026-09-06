-- Run against a migrated database with psql -v ON_ERROR_STOP=1 -f this-file.
-- All fixtures and writes are rolled back.
BEGIN;
INSERT INTO public.curated_apps (winget_id, name, publisher, latest_version)
VALUES ('IntuneGet.HistoryFixture', 'History Fixture', 'IntuneGet', '2.0');
INSERT INTO public.version_history (winget_id, version, created_at, release_date)
VALUES ('IntuneGet.HistoryFixture', '1.0', '2026-01-31T23:59:00Z', NULL),
       ('IntuneGet.HistoryFixture', '2.0', '2026-02-01T00:01:00Z', '2026-01-30T00:00:00Z');
UPDATE public.version_history SET created_at = now() WHERE winget_id = 'IntuneGet.HistoryFixture';
SET LOCAL ROLE anon;
DO $$
DECLARE result jsonb;
BEGIN
  result := public.get_catalog_release_history('IntuneGet.HistoryFixture', '2026-02', 'updated', 1);
  IF (result->>'total')::int <> 1 OR result->'rows'->0->>'previous_version' <> '1.0' THEN
    RAISE EXCEPTION 'Month filter or previous version failed: %', result;
  END IF;
  IF (result->'rows'->0->>'detected_at')::timestamptz <> '2026-02-01T00:01:00Z'::timestamptz THEN
    RAISE EXCEPTION 'First observation changed during refresh';
  END IF;
  result := public.get_catalog_release_history('IntuneGet.HistoryFixture', '', 'first', 1);
  IF (result->>'firstTracked')::int <> 1 OR result->'rows'->0->>'version' <> '1.0' THEN
    RAISE EXCEPTION 'First-tracked classification failed';
  END IF;
  result := public.get_catalog_release_history('IntuneGet.HistoryFixture', '', 'all', 2);
  IF jsonb_array_length(result->'rows') <> 0 OR (result->>'total')::int <> 2 THEN
    RAISE EXCEPTION 'Pagination changed totals';
  END IF;
END;
$$;
ROLLBACK;
