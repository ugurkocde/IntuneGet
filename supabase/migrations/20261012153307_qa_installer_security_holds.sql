-- A refused installer is identified by bytes, independently of app/profile.
-- No expiry releases a hold. Only a newer confirmed clean cached verdict can.
create table public.qa_installer_security_holds (
  sha256 text primary key check (sha256 ~ '^[a-f0-9]{64}$'),
  reason text not null default 'VirusTotal refused execution for this installer hash.',
  first_held_at timestamptz not null default now(),
  verdict_at timestamptz not null default now(),
  next_check_at timestamptz not null default now() + interval '24 hours',
  checked_at timestamptz,
  released_at timestamptz
);
alter table public.qa_installer_security_holds enable row level security;
revoke all on public.qa_installer_security_holds from public, anon, authenticated;
grant select, insert, update on public.qa_installer_security_holds to service_role;

-- Statement locks precede row locks, including direct recovery/enqueue writes.
create function public.lock_qa_installer_security() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch', 0));
  return null;
end;
$$;
revoke all on function public.lock_qa_installer_security() from public, anon, authenticated;
create trigger qa_installer_security_lock before insert or update on public.qa_candidates
for each statement execute function public.lock_qa_installer_security();
create trigger qa_reputation_security_lock before insert or update on public.catalog_file_reputation
for each statement execute function public.lock_qa_installer_security();
create trigger qa_curated_security_lock before insert or update on public.curated_verification_queue
for each statement execute function public.lock_qa_installer_security();

create function public.qa_curated_installer_security_held(p_inputs jsonb) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare payload jsonb; source text; hash text;
begin
  foreach source in array array['candidate','previous'] loop
    if nullif(p_inputs->>source, '') is null then continue; end if;
    begin payload := (p_inputs->>source)::jsonb;
    exception when invalid_text_representation then return true; end;
    hash := lower(payload->>'vendorSha256');
    if hash ~ '^[a-f0-9]{64}$' and hash <> repeat('0',64) and exists (
      select 1 from public.qa_installer_security_holds where sha256 = hash and released_at is null
    ) then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function public.qa_curated_installer_security_held(jsonb) from public, anon, authenticated;
grant execute on function public.qa_curated_installer_security_held(jsonb) to service_role;

create function public.guard_curated_installer_security() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'dispatched' and (tg_op = 'INSERT' or old.status is distinct from 'dispatched')
     and public.qa_curated_installer_security_held(new.inputs) then
    raise exception 'Installer security hold prevents curated QA dispatch';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_curated_installer_security() from public, anon, authenticated;
create trigger qa_curated_security_guard before insert or update on public.curated_verification_queue
for each row execute function public.guard_curated_installer_security();

create function public.next_qa_curated_security_eligible() returns jsonb
language sql security invoker set search_path = '' as $$
  select to_jsonb(q) from public.curated_verification_queue q
  where status = 'queued' and not public.qa_curated_installer_security_held(inputs)
  order by priority desc, enqueued_at, id limit 1;
$$;
revoke all on function public.next_qa_curated_security_eligible() from public, anon, authenticated;
grant execute on function public.next_qa_curated_security_eligible() to service_role;

create function public.qa_installer_security_waiting_errors() returns jsonb
language sql security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('candidate', to_jsonb(s.candidate), 'nextCheckAt', s.next_check_at)), '[]')
  from (select c as candidate, h.next_check_at from public.qa_candidates c
    join public.qa_installer_security_holds h on h.sha256 = lower(c.installer_sha256) and h.released_at is null
    where c.status = 'error' and c.test_level = 'psadt-package'
    order by c.priority desc, c.enqueued_at, c.id limit 10) s;
$$;
revoke all on function public.qa_installer_security_waiting_errors() from public, anon, authenticated;
grant execute on function public.qa_installer_security_waiting_errors() to service_role;

create function public.guard_qa_installer_security() returns trigger
language plpgsql security definer set search_path = '' as $$
declare due timestamptz;
begin
  -- This exact summary is emitted by the authenticated host reporter. A
  -- scanning crash, cancellation or lookup outage is not a security verdict.
  if tg_op = 'UPDATE' and old.status in ('dispatched','running') and new.status = 'error'
     and new.failure_summary ~ '^VirusTotal flagged this exact installer hash \([0-9]+ malicious verdicts\); QA execution refused\.$'
     and new.installer_sha256 ~ '^[A-Fa-f0-9]{64}$' then
    insert into public.qa_installer_security_holds(sha256)
    values(lower(new.installer_sha256))
    on conflict(sha256) do update set released_at = null,
      verdict_at = now(), next_check_at = greatest(qa_installer_security_holds.next_check_at, now() + interval '24 hours');
  end if;
  select next_check_at into due from public.qa_installer_security_holds
    where sha256 = lower(new.installer_sha256) and released_at is null;
  if found then
    if new.status = 'dispatched' and (tg_op = 'INSERT' or old.status is distinct from 'dispatched') then
      raise exception 'Installer security hold prevents QA dispatch';
    end if;
    if new.status in ('queued','error') then
      new.next_retry_at := greatest(new.next_retry_at, due);
      if new.status = 'queued' or new.failure_summary ~ '^VirusTotal flagged this exact installer hash '
         or (new.phase = 'scanning_installer' and new.failure_summary = 'QA result publication did not complete; inspect the protected workflow run.') then
        new.failure_summary := 'VirusTotal refused execution for this installer hash.';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_qa_installer_security() from public, anon, authenticated;
create trigger qa_installer_security_guard before insert or update on public.qa_candidates
for each row execute function public.guard_qa_installer_security();

create function public.hold_flagged_qa_reputation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Preserve the existing malicious >= 1 refusal policy.
  if new.status = 'found' and new.malicious >= 1 and new.sha256 ~ '^[A-Fa-f0-9]{64}$' then
    insert into public.qa_installer_security_holds(sha256, verdict_at)
    values(lower(new.sha256), coalesce(new.analyzed_at, new.checked_at, now()))
    on conflict(sha256) do update set released_at = null,
      verdict_at = greatest(qa_installer_security_holds.verdict_at, excluded.verdict_at);
  end if;
  return new;
end;
$$;
revoke all on function public.hold_flagged_qa_reputation() from public, anon, authenticated;
create trigger qa_reputation_security_hold after insert or update on public.catalog_file_reputation
for each row execute function public.hold_flagged_qa_reputation();

insert into public.qa_installer_security_holds(sha256, verdict_at)
select lower(sha256), coalesce(analyzed_at, checked_at, now())
from public.catalog_file_reputation where status = 'found' and malicious >= 1
  and sha256 ~ '^[A-Fa-f0-9]{64}$'
on conflict do nothing;

-- Adopt externally verified, pre-execution refusals without inventing cache
-- verdicts. The caller must verify the trusted workflow's exact refusal log;
-- this service-only path binds its evidence to the current terminal run.
create function public.record_qa_installer_security_refusal(
  p_candidate_id uuid, p_run_id text, p_sha256 text,
  p_malicious integer, p_observed_at timestamptz
) returns void
language plpgsql security invoker set search_path = '' as $$
declare candidate public.qa_candidates%rowtype; held public.qa_installer_security_holds%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch', 0));
  select * into candidate from public.qa_candidates where id = p_candidate_id for update;
  if not found or candidate.status is distinct from 'error'
     or candidate.test_level is distinct from 'psadt-package'
     or p_run_id is null or p_run_id !~ '^[0-9]+$'
     or candidate.github_run_id is distinct from p_run_id
     or p_sha256 is null or lower(p_sha256) !~ '^[a-f0-9]{64}$'
     or lower(p_sha256) = repeat('0',64)
     or lower(candidate.installer_sha256) is distinct from lower(p_sha256)
     or p_malicious is null or p_malicious < 1
     or p_observed_at is null or coalesce(candidate.started_at, candidate.dispatched_at) is null
     or p_observed_at < coalesce(candidate.started_at, candidate.dispatched_at)
     or p_observed_at > least(coalesce(candidate.finished_at, now()), now()) then
    raise exception 'Installer refusal evidence does not match the terminal QA run';
  end if;
  select * into held from public.qa_installer_security_holds where sha256 = lower(p_sha256) for update;
  if found and held.released_at is not null and held.released_at >= p_observed_at then
    raise exception 'Installer refusal evidence is superseded by a newer release';
  end if;
  insert into public.qa_installer_security_holds(sha256, verdict_at)
  values(lower(p_sha256), p_observed_at)
  on conflict(sha256) do update set
    verdict_at = greatest(qa_installer_security_holds.verdict_at, excluded.verdict_at),
    first_held_at = case when qa_installer_security_holds.released_at is null then qa_installer_security_holds.first_held_at else now() end,
    next_check_at = case when qa_installer_security_holds.released_at is null then qa_installer_security_holds.next_check_at else now() + interval '24 hours' end,
    checked_at = case when qa_installer_security_holds.released_at is null then qa_installer_security_holds.checked_at else null end,
    released_at = null;
  update public.qa_candidates set failure_summary = 'VirusTotal refused execution for this installer hash.'
    where id = p_candidate_id;
  update public.qa_candidates set next_retry_at = next_retry_at
    where id <> p_candidate_id and status in ('queued','error')
      and lower(installer_sha256) = lower(p_sha256);
end;
$$;
revoke all on function public.record_qa_installer_security_refusal(uuid,text,text,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.record_qa_installer_security_refusal(uuid,text,text,integer,timestamptz) to service_role;

-- Preserve the installed claimant and its existing pin, grant and VM guards.
do $$
declare definition text; original text; anchor text; curated_anchor text;
begin
  original := pg_get_functiondef('public.claim_qa_work(text,uuid,text)'::regprocedure);
  anchor := 'and next_retry_at <= now()';
  if length(original) - length(replace(original, anchor, '')) <> length(anchor) then
    raise exception 'QA claimant security anchor changed';
  end if;
  definition := replace(original, anchor, anchor || E'\n        and not exists (select 1 from public.qa_installer_security_holds h where h.sha256 = lower(qa_candidates.installer_sha256) and h.released_at is null)');
  curated_anchor := 'from public.curated_verification_queue where status = ''queued''';
  if length(definition) - length(replace(definition, curated_anchor, '')) <> length(curated_anchor) then
    raise exception 'Curated claimant security anchor changed';
  end if;
  definition := replace(definition, curated_anchor, curated_anchor || ' and not public.qa_curated_installer_security_held(inputs)');
  execute definition;
end;
$$;

create function public.refresh_qa_installer_security_holds() returns integer
language plpgsql security invoker set search_path = '' as $$
declare held public.qa_installer_security_holds%rowtype; cached public.catalog_file_reputation%rowtype; checked integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch', 0));
  for held in
    update public.qa_installer_security_holds set checked_at = now(), next_check_at = now() + interval '24 hours'
    where released_at is null and next_check_at <= now() returning *
  loop
    checked := checked + 1;
    select * into cached from public.catalog_file_reputation where sha256 = held.sha256;
    if found and cached.status = 'found' and cached.malicious = 0 and cached.suspicious = 0
       and cached.total_engines > 0 and cached.analyzed_at > held.verdict_at
       and cached.checked_at > held.first_held_at then
      update public.qa_installer_security_holds set released_at = now() where sha256 = held.sha256;
      -- Release only the daily security cooldown, retaining independent source
      -- backoff and every compatibility/quarantine and diagnostic grant guard.
      update public.qa_candidates set next_retry_at = now(), status = 'queued'
      where lower(installer_sha256) = held.sha256 and status in ('queued','error')
        and failure_summary = 'VirusTotal refused execution for this installer hash.';
    else
      update public.qa_candidates set next_retry_at = greatest(next_retry_at, held.next_check_at)
        where lower(installer_sha256) = held.sha256 and status in ('queued','error');
    end if;
  end loop;
  return checked;
end;
$$;
revoke all on function public.refresh_qa_installer_security_holds() from public, anon, authenticated;
grant execute on function public.refresh_qa_installer_security_holds() to service_role;

-- Existing error rows with confirmed flagged caches become visible waiting
-- work, without execution, an attempt reset, repair closure or customer writes.
update public.qa_candidates set next_retry_at = next_retry_at
where status in ('queued','error') and exists (
  select 1 from public.qa_installer_security_holds h
  where h.sha256 = lower(qa_candidates.installer_sha256) and h.released_at is null
);
