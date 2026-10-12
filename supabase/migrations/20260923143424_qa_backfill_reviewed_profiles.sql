-- Apply the same reviewed customer-terminal filter before selecting the newest profile.
drop function public.qa_toolchain_backfill_page(text, integer);

create function public.qa_toolchain_backfill_page(p_after text default '', p_limit integer default 100, p_terminal_retry_ids text[] default '{}')
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(page) order by page.winget_id), '[]'::jsonb)
  from (
    select c.id, c.winget_id, c.version, c.architecture, c.installer_sha256,
           c.enqueued_at, c.package_profile_sha256, c.test_config, c.status, c.priority, c.demand_source
    from public.curated_apps a
    cross join lateral (
      select q.* from public.qa_candidates q
      where q.winget_id = a.winget_id and q.test_level = 'psadt-package'
        and q.package_profile_sha256 is not null
        and (q.test_config->>'profileKind' = 'catalog-default'
          or (q.test_config->>'profileKind' = 'deployment-config' and q.demand_source = 'customer'
              and q.status in ('failed','error') and lower(q.winget_id) = any(p_terminal_retry_ids)))
      order by q.enqueued_at desc, q.id desc limit 1
    ) c
    where a.winget_id > p_after and a.is_verified and a.is_winget_verified
      and a.app_source = 'win32' and not a.is_locale_variant
      and (exists (select 1 from public.upload_history h where h.winget_id = a.winget_id)
        or exists (select 1 from public.packaging_jobs j where j.winget_id = a.winget_id and j.status in ('awaiting_qa','qa_failed')))
    order by a.winget_id limit least(greatest(p_limit, 1), 100)
  ) page;
$$;
revoke all on function public.qa_toolchain_backfill_page(text, integer, text[]) from public, anon, authenticated;
grant execute on function public.qa_toolchain_backfill_page(text, integer, text[]) to service_role;
