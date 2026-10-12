-- Allow transient manifest drift results to be reclaimed after their TTL.

create or replace function public.claim_installer_preflight(
  p_cache_key text,
  p_winget_id text,
  p_version text,
  p_architecture text,
  p_installer_url text,
  p_expected_sha256 text,
  p_lease_seconds integer default 240
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  affected_rows bigint := 0;
begin
  insert into public.installer_health (
    cache_key, winget_id, version, architecture, installer_url,
    expected_sha256, status, lease_expires_at, updated_at
  ) values (
    p_cache_key, p_winget_id, p_version, p_architecture, p_installer_url,
    upper(p_expected_sha256), 'checking',
    now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))), now()
  )
  on conflict (cache_key) do nothing;

  get diagnostics affected_rows = row_count;
  if affected_rows > 0 then return true; end if;

  update public.installer_health
  set status = 'checking',
      reason_code = null,
      reason_message = null,
      lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
      updated_at = now()
  where cache_key = p_cache_key
    and status <> 'quarantined'
    and (
      (status = 'checking' and lease_expires_at <= now())
      or (status in ('healthy', 'error') and coalesce(expires_at, '-infinity'::timestamptz) <= now())
    );

  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

revoke all on function public.claim_installer_preflight(text, text, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_installer_preflight(text, text, text, text, text, text, integer)
  to service_role;
