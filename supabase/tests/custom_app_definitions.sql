-- Run against a local migrated database with psql -v ON_ERROR_STOP=1.
-- Definitions are accessible through the authenticated application API only.
BEGIN;
DO $$
DECLARE role_name text; operation text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.custom_app_definitions'::regclass) THEN
    RAISE EXCEPTION 'Saved definitions must have RLS enabled';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH operation IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(role_name, 'public.custom_app_definitions', operation) THEN
        RAISE EXCEPTION 'Browser role must not access saved definitions';
      END IF;
    END LOOP;
  END LOOP;
  FOREACH operation IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT has_table_privilege('service_role', 'public.custom_app_definitions', operation) THEN
      RAISE EXCEPTION 'Application service role is missing a required operation';
    END IF;
  END LOOP;
END $$;
SET LOCAL ROLE service_role;
INSERT INTO public.custom_app_definitions (user_id, tenant_id, definition)
VALUES ('fixture-owner', 'fixture-tenant', '{"displayName":"Fixture"}');
UPDATE public.custom_app_definitions SET definition = '{"displayName":"New fixture"}'
WHERE user_id = 'fixture-owner' AND tenant_id = 'fixture-tenant';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.custom_app_definitions WHERE user_id = 'fixture-owner' AND tenant_id = 'fixture-tenant' AND definition->>'displayName' = 'New fixture') <> 1 THEN
    RAISE EXCEPTION 'Service role persistence failed';
  END IF;
  BEGIN
    INSERT INTO public.custom_app_definitions (user_id, tenant_id, definition) VALUES ('fixture-owner', 'fixture-tenant', '[]');
    RAISE EXCEPTION 'Non-object definition was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
DELETE FROM public.custom_app_definitions WHERE user_id = 'fixture-owner' AND tenant_id = 'fixture-tenant';
ROLLBACK;
