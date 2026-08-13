-- Supabase default privileges can retain explicit function grants for API
-- roles across CREATE OR REPLACE. Keep the QA synchronization surface scoped
-- to the anonymous role used with the dedicated QA-only secret.
revoke all on function public.sync_qa_results(text, jsonb, boolean)
  from public, authenticated, service_role;
revoke all on function public.record_qa_sync_failure(text)
  from public, authenticated, service_role;

grant execute on function public.sync_qa_results(text, jsonb, boolean) to anon;
grant execute on function public.record_qa_sync_failure(text) to anon;
