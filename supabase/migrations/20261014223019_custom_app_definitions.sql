CREATE TABLE public.custom_app_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  definition JSONB NOT NULL CHECK (jsonb_typeof(definition) = 'object' AND octet_length(definition::text) <= 16384),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_custom_app_definitions_owner ON public.custom_app_definitions(user_id, tenant_id, updated_at DESC, id DESC);
ALTER TABLE public.custom_app_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.custom_app_definitions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_app_definitions TO service_role;
COMMENT ON TABLE public.custom_app_definitions IS 'Static custom app metadata. The API authorizes both user and tenant; version, installer URL and hash are supplied anew for deployment.';
