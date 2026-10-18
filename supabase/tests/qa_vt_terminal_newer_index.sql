-- Exercise the case-insensitive newer-candidate lookup at catalog scale.
begin;
insert into public.qa_candidates(id,winget_id,version,architecture,installer_sha256,
  package_profile_sha256,status,enqueued_at)
select gen_random_uuid(),'IndexFixture.App'||g,'1','x64',repeat('a',64),repeat('B',64),
  'passed','2026-01-01T00:00:00Z'::timestamptz
from generate_series(1,20000) g;
insert into public.qa_candidates(id,winget_id,version,architecture,installer_sha256,
  package_profile_sha256,status,enqueued_at) values
  (gen_random_uuid(),'IndexFixture.Target','1','x64',repeat('a',64),repeat('B',64),'passed','2026-01-02Z'),
  (gen_random_uuid(),'indexfixture.target','2','x64',repeat('c',64),repeat('D',64),'passed','2026-01-03Z'),
  (gen_random_uuid(),'INDEXFIXTURE.TARGET','3','x86',repeat('e',64),repeat('F',64),'passed','2026-01-03Z');
analyze public.qa_candidates;
do $$
declare plan json; matches integer;
begin
  select count(*) into matches from public.qa_candidates newer
  where lower(newer.winget_id)=lower('IndexFixture.Target')
    and newer.architecture='x64' and newer.enqueued_at>'2026-01-02Z'::timestamptz
    and newer.status<>'superseded';
  if matches<>1 then raise exception 'Case-insensitive architecture/time lookup changed'; end if;
  execute $plan$explain(format json) select 1 from public.qa_candidates newer
    where lower(newer.winget_id)=lower('IndexFixture.Target')
      and newer.architecture='x64' and newer.enqueued_at>'2026-01-02Z'::timestamptz
      and newer.status<>'superseded'$plan$ into plan;
  if position('qa_candidates_terminal_newer_idx' in plan::text)=0 then
    raise exception 'Newer-candidate lookup requires a matching expression index';
  end if;
end;
$$;
rollback;
