-- Preparatory evidence bridge. This never admits a lookup or releases a hold.
create table public.qa_dependency_execution_receipts (
  candidate_id uuid not null references public.qa_candidates(id),
  run_id text not null check (run_id ~ '^[1-9][0-9]*$'),
  run_attempt integer not null check (run_attempt > 0),
  profile_sha256 text not null check (profile_sha256 ~ '^[A-F0-9]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[A-F0-9]{64}$'),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  receipt_sha256 text not null check (receipt_sha256 ~ '^[A-F0-9]{64}$'),
  lifecycle_outcome text not null check (lifecycle_outcome in ('Passed','Failed')),
  receipt jsonb not null check (jsonb_typeof(receipt)='object' and octet_length(receipt::text)<=8192),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(candidate_id,run_id,run_attempt)
);
alter table public.qa_dependency_execution_receipts enable row level security;
revoke all on public.qa_dependency_execution_receipts from public,anon,authenticated,service_role;
grant select on public.qa_dependency_execution_receipts to service_role;

create function public.record_qa_dependency_receipt(p_secret text,p_candidate_id uuid,
  p_run_id text,p_run_attempt integer,p_expected_content_sha256 text,p_receipt jsonb,
  p_lifecycle_outcome text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c public.qa_candidates%rowtype; canonical jsonb; entries jsonb; entry jsonb; dep jsonb;
  serialized_entries text[] := '{}'; preimage text; wanted integer := 0; inserted integer;
  stamp timestamptz := clock_timestamp();
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  select * into c from public.qa_candidates where id=p_candidate_id for update;
  if not found or c.status is distinct from 'running' or c.test_level is distinct from 'psadt-package'
    or c.github_run_id is distinct from p_run_id or p_run_id is null or p_run_id !~ '^[1-9][0-9]*$'
    or p_run_attempt is null or p_run_attempt not between 1 and 2147483647
    or c.dispatched_at is null or c.dispatched_at>stamp or c.dispatched_at<=stamp-interval '14 days'
    or p_lifecycle_outcome is null or p_lifecycle_outcome not in ('Passed','Failed')
    or p_expected_content_sha256 is null or p_expected_content_sha256 !~ '^[A-F0-9]{64}$'
    or p_expected_content_sha256=repeat('0',64)
    or not exists(select 1 from public.packaging_jobs j where j.qa_candidate_id=c.id and j.status='awaiting_qa')
    or exists(select 1 from public.qa_candidates n where lower(n.winget_id)=lower(c.winget_id)
      and n.architecture=c.architecture and n.status<>'superseded' and n.enqueued_at>c.enqueued_at
      and (n.version is distinct from c.version or n.package_profile_sha256 is distinct from c.package_profile_sha256
        or lower(n.installer_sha256) is distinct from lower(c.installer_sha256))) then return false;end if;
  -- The host binds the actual prepared archive's content digest. Candidates do
  -- not contain a content digest before a package is built; do not invent one.
  if p_receipt is null or jsonb_typeof(p_receipt) is distinct from 'object'
    or octet_length(p_receipt::text)>8192
    or (select count(*) from jsonb_object_keys(p_receipt))<>13
    or not (p_receipt ?& array['schemaVersion','status','candidateId','executionContext','testId','runId',
      'runAttempt','sourceCommit','packageProfileSha256','packageContentSha256','packagerCommit','entries','sha256'])
    or exists(select 1 from jsonb_each(p_receipt) where key not in ('schemaVersion','runAttempt','entries')
      and jsonb_typeof(value) is distinct from 'string')
    or p_receipt->'schemaVersion' is distinct from '1'::jsonb or p_receipt->>'status' is distinct from 'recorded'
    or p_receipt->>'executionContext' is distinct from 'LocalSystem'
    or p_receipt->>'candidateId' is distinct from c.id::text
    or p_receipt->>'runId' is distinct from p_run_id
    or p_receipt->'runAttempt' is distinct from to_jsonb(p_run_attempt)
    or p_receipt->>'testId' is distinct from 'github-'||p_run_id||'-'||p_run_attempt::text
    or p_receipt->>'sourceCommit' !~ '^[a-f0-9]{40}$'
    or p_receipt->>'packageProfileSha256' is distinct from c.package_profile_sha256
    or p_receipt->>'packageContentSha256' is distinct from p_expected_content_sha256
    or p_receipt->>'sha256' !~ '^[A-F0-9]{64}$'
    or jsonb_typeof(p_receipt->'entries') is distinct from 'array'
    or jsonb_array_length(p_receipt->'entries') not between 1 and 8 then return false;end if;
  if c.test_config->>'packageProfileCanonicalJson' is null
    or upper(encode(extensions.digest(c.test_config->>'packageProfileCanonicalJson','sha256'),'hex'))
      is distinct from c.package_profile_sha256 then return false;end if;
  canonical := (c.test_config->>'packageProfileCanonicalJson')::jsonb;
  if canonical#>>'{app,wingetId}' is distinct from c.winget_id
    or canonical#>>'{app,version}' is distinct from c.version
    or canonical#>>'{app,architecture}' is distinct from c.architecture
    or upper(canonical#>>'{installer,sha256}') is distinct from upper(c.installer_sha256)
    or canonical#>>'{toolchain,packagerCommit}' is distinct from p_receipt->>'packagerCommit'
    or p_receipt->>'packagerCommit' !~ '^[a-f0-9]{40}$'
    or jsonb_typeof(canonical#>'{installer,packageDependencies}') is distinct from 'array'
    or jsonb_array_length(canonical#>'{installer,packageDependencies}')<>jsonb_array_length(p_receipt->'entries')
    then return false;end if;
  entries := p_receipt->'entries';
  for entry in select value from jsonb_array_elements(entries) loop
    wanted := wanted+1;
    dep := canonical#>'{installer,packageDependencies}'->(wanted-1);
    if jsonb_typeof(entry) is distinct from 'object' or (select count(*) from jsonb_object_keys(entry))<>7
      or not (entry ?& array['order','packageIdentifier','version','architecture','sha256','exitCode','classification'])
      or exists(select 1 from jsonb_each(entry) where key not in ('order','exitCode')
        and jsonb_typeof(value) is distinct from 'string')
      or entry->'order' is distinct from to_jsonb(wanted) or dep->'order' is distinct from to_jsonb(wanted)
      or entry->>'packageIdentifier' !~ '^[A-Za-z0-9][A-Za-z0-9.+-]{1,150}$'
      or entry->>'version' !~ '^[0-9]+(\.[0-9]+){1,3}$'
      or entry->>'architecture' not in ('x86','x64','arm64')
      or entry->>'sha256' !~ '^[A-F0-9]{64}$' or entry->>'sha256'=repeat('0',64)
      or lower(entry->>'sha256')=lower(c.installer_sha256)
      or entry->>'packageIdentifier' is distinct from dep->>'packageIdentifier'
      or entry->>'version' is distinct from dep->>'version'
      or entry->>'architecture' is distinct from dep->>'architecture'
      or entry->>'sha256' is distinct from dep->>'sha256'
      or jsonb_typeof(entry->'exitCode') is distinct from 'number'
      or entry->>'exitCode' !~ '^-?[0-9]{1,11}$'
      or (entry->>'exitCode')::bigint not between -2147483648 and 2147483647
      or entry->>'classification' not in ('installed','unconfirmed')
      or (entry->>'classification'='installed' and (entry->>'exitCode')::integer not in (0,3010))
      then return false;end if;
    serialized_entries := array_append(serialized_entries,replace(replace(json_build_object(
      'order',wanted,'packageIdentifier',entry->>'packageIdentifier','version',entry->>'version',
      'architecture',entry->>'architecture','sha256',entry->>'sha256',
      'exitCode',(entry->>'exitCode')::integer,'classification',entry->>'classification')::text,', ',','),' : ',':'));
  end loop;
  -- Fixed field order and ASCII-only string values reproduce both PowerShell
  -- engines' compact serializer without trusting JSONB's object key order.
  preimage := replace(replace(json_build_object('schemaVersion',1,'status','recorded',
    'candidateId',c.id::text,'executionContext','LocalSystem','testId',p_receipt->>'testId',
    'runId',p_run_id,'runAttempt',p_run_attempt,'sourceCommit',p_receipt->>'sourceCommit',
    'packageProfileSha256',c.package_profile_sha256,'packageContentSha256',p_expected_content_sha256,
    'packagerCommit',p_receipt->>'packagerCommit','entries',('['||array_to_string(serialized_entries,',')||']')::json)::text,', ',','),' : ',':');
  if upper(encode(extensions.digest(preimage,'sha256'),'hex')) is distinct from p_receipt->>'sha256' then return false;end if;
  insert into public.qa_dependency_execution_receipts(candidate_id,run_id,run_attempt,profile_sha256,
    content_sha256,source_commit,receipt_sha256,lifecycle_outcome,receipt)
  values(c.id,p_run_id,p_run_attempt,c.package_profile_sha256,p_expected_content_sha256,
    p_receipt->>'sourceCommit',p_receipt->>'sha256',p_lifecycle_outcome,p_receipt)
  on conflict(candidate_id,run_id,run_attempt) do nothing;
  get diagnostics inserted=row_count;
  return inserted=1;
end;
$$;
revoke all on function public.record_qa_dependency_receipt(text,uuid,text,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.record_qa_dependency_receipt(text,uuid,text,integer,text,jsonb,text) to anon,service_role;
