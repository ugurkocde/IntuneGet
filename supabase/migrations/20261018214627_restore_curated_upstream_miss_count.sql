-- Restore the counter required by hourly catalog sync without replaying unrelated DDL.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if current_setting('lock_timeout') <> '5s'
    or current_setting('statement_timeout') <> '30s' then
    raise exception 'Catalog counter migration requires a transaction with bounded timeouts';
  end if;
end;
$$;

alter table public.curated_apps
  add column if not exists upstream_miss_count integer not null default 0
  check (upstream_miss_count >= 0);

-- A fresh installation already received this column from the earlier migration.
-- Reject incompatible drift instead of silently accepting an existing column.
do $$
begin
  if not exists (
    select 1 from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.curated_apps'::regclass
      and a.attname = 'upstream_miss_count' and not a.attisdropped
      and a.atttypid = 'integer'::regtype and a.attnotnull
      and a.attidentity = '' and a.attgenerated = ''
      and pg_get_expr(d.adbin, d.adrelid) = '0'
      and exists (
        select 1 from pg_constraint c
        where c.conrelid = a.attrelid and c.contype = 'c'
          and c.conkey = array[a.attnum] and c.convalidated
          and pg_get_constraintdef(c.oid) = 'CHECK ((upstream_miss_count >= 0))'
      )
  ) then
    raise exception 'Incompatible curated_apps.upstream_miss_count definition';
  end if;
end;
$$;

comment on column public.curated_apps.upstream_miss_count is
  'Consecutive package_or_version_missing results from the manifest sync.';

notify pgrst, 'reload schema';
