-- Run on a migrated database. Fixtures and writes are rolled back.
BEGIN;
INSERT INTO public.curated_apps (winget_id, name, publisher, latest_version)
VALUES ('IntuneGet.FilterFixture', 'Filter fixture', 'IntuneGet', '3'),
       ('IntuneGet.FilterFixture.More', 'Filter fixture extra', 'IntuneGet', '1');
INSERT INTO public.version_history (winget_id, version, created_at, installers)
VALUES ('IntuneGet.FilterFixture', '1', '2026-01-31T23:59:59Z', '[{"Architecture":"x86"}]'),
       ('IntuneGet.FilterFixture', '2', '2026-02-01T00:00:00Z', '[{"Architecture":"arm64"},{"Architecture":"x64"}]'),
       ('IntuneGet.FilterFixture', '3', '2026-02-01T23:59:59Z', '[{"Architecture":"x64"}]'),
       ('IntuneGet.FilterFixture.More', '1', '2026-02-01T12:00:00Z', '[{"Architecture":"x64"}]');
SET LOCAL ROLE anon;
SET LOCAL TIME ZONE 'Pacific/Auckland';
DO $$
DECLARE result jsonb;
BEGIN
  result := public.get_catalog_release_history_v2(app_filter => 'intuneget.filterfixture', date_from => '2026-02-01', date_to => '2026-02-01');
  IF (result->>'total')::int <> 2 OR (result->>'apps')::int <> 1 OR (result->>'firstTracked')::int <> 0 THEN
    RAISE EXCEPTION 'Exact app or inclusive UTC date filter failed: %', result;
  END IF;
  result := public.get_catalog_release_history_v2(app_filter => 'IntuneGet.FilterFixture', date_from => '2026-02-01', architecture_filter => 'arm64');
  IF (result->>'total')::int <> 1 OR result->'rows'->0->>'previous_version' <> '1' THEN
    RAISE EXCEPTION 'Architecture filter changed predecessor: %', result;
  END IF;
  result := public.get_catalog_release_history_v2(app_filter => 'IntuneGet.FilterFixture', architecture_filter => 'x64', page_number => 2);
  IF (result->>'total')::int <> 2 OR jsonb_array_length(result->'rows') <> 0 THEN
    RAISE EXCEPTION 'Filtered pagination totals failed';
  END IF;
END $$;
ROLLBACK;
