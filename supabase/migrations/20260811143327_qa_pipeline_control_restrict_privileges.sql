-- Supabase's default table grants include broader service-role privileges.
-- The application only needs to read and flip the singleton pause row.
revoke all on table public.qa_pipeline_control from service_role;
grant select, update on table public.qa_pipeline_control to service_role;
