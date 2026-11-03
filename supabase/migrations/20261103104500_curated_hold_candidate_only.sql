-- A security hold blocks only the installer it names. A held upgrade baseline
-- must not hold a newer curated release: the baseline still runs only inside
-- the disposable VM, and approval still requires a clean in-VM scan of both
-- installers (lib/curated-catalog/verification-evidence.ts).
create or replace function public.qa_curated_installer_security_held(p_inputs jsonb) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare payload jsonb; hash text;
begin
  if nullif(p_inputs->>'candidate', '') is null then return false; end if;
  begin payload := (p_inputs->>'candidate')::jsonb;
  exception when invalid_text_representation then return true; end;
  hash := lower(payload->>'vendorSha256');
  return hash ~ '^[a-f0-9]{64}$' and hash <> repeat('0',64) and exists (
    select 1 from public.qa_installer_security_holds where sha256 = hash and released_at is null
  );
end;
$$;
revoke all on function public.qa_curated_installer_security_held(jsonb) from public, anon, authenticated;
grant execute on function public.qa_curated_installer_security_held(jsonb) to service_role;
