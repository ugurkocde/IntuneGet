-- Production enables safe-update protection, which requires an explicit WHERE
-- clause even for an intentional full-table recipe deactivation.
create or replace function public.sync_qa_results_v2(
  p_secret text,
  p_rows jsonb,
  p_recipes jsonb,
  p_allow_large_delete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  sync_result jsonb;
begin
  sync_result := public.sync_qa_results(p_secret, p_rows, p_allow_large_delete);

  update public.qa_results result
  set installer_sha256 = upper(row_data.installer_sha256)
  from jsonb_to_recordset(p_rows) as row_data(
    winget_id text,
    installer_sha256 text
  )
  where result.winget_id = row_data.winget_id;

  if jsonb_typeof(p_recipes) <> 'array' or jsonb_array_length(p_recipes) = 0 then
    raise exception 'At least one canonical QA recipe is required';
  end if;

  update public.qa_recipes
  set active = false, updated_at = now()
  where active = true;

  insert into public.qa_recipes (
    winget_id,
    definition_path,
    architecture,
    installer_type,
    active,
    updated_at
  )
  select
    recipe.winget_id,
    recipe.definition_path,
    recipe.architecture,
    recipe.installer_type,
    true,
    now()
  from jsonb_to_recordset(p_recipes) as recipe(
    winget_id text,
    definition_path text,
    architecture text,
    installer_type text
  )
  on conflict (winget_id) do update set
    definition_path = excluded.definition_path,
    architecture = excluded.architecture,
    installer_type = excluded.installer_type,
    active = true,
    updated_at = excluded.updated_at;

  return sync_result || jsonb_build_object('recipes', jsonb_array_length(p_recipes));
end;
$$;

revoke all on function public.sync_qa_results_v2(text, jsonb, jsonb, boolean)
  from public, authenticated, service_role;
grant execute on function public.sync_qa_results_v2(text, jsonb, jsonb, boolean) to anon;
