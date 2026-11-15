-- PostgREST hoists these function settings before the request statement.
-- A direct SQL call does not enforce a timeout set inside its current statement.
ALTER FUNCTION public.qa_missing_demand_backfill_ids(integer) SET statement_timeout = '2s';
ALTER FUNCTION public.qa_idle_catalog_backfill_ids(integer) SET statement_timeout = '2s';
ALTER FUNCTION public.qa_toolchain_backfill_page(text, integer, text[]) SET statement_timeout = '2s';
