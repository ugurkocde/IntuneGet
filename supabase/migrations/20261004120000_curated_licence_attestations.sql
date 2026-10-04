-- Curated applications can require the customer to accept the publisher's
-- distribution licence before IntuneGet packages or deploys them for a tenant.
-- One row records a tenant's acceptance of one exact agreement version. The
-- packaging routes read it server-side; browsers never access it directly.
CREATE TABLE public.curated_licence_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 64),
  app_id text NOT NULL CHECK (app_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  attestation_id text NOT NULL CHECK (attestation_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(attestation_id) <= 64),
  attestation_version text NOT NULL CHECK (attestation_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  accepted_by_user_id text NOT NULL CHECK (length(accepted_by_user_id) BETWEEN 1 AND 128),
  accepted_by_email text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curated_licence_attestations_tenant_version_key
    UNIQUE (tenant_id, attestation_id, attestation_version)
);

ALTER TABLE public.curated_licence_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.curated_licence_attestations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.curated_licence_attestations TO service_role;
