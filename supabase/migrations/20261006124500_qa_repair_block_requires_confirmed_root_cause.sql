-- An application failure may only close as blocked when the block is
-- automatic (security verdict, or the three re-queue budget is spent) or the
-- repair automation confirmed a root cause that shared packaging cannot fix.
-- An unconfirmed root cause means the repair is not finished: the request
-- stays open and uses its re-queue budget. A payload quarantine may protect
-- customers meanwhile, but it never closes the request.

-- Reopen requests blocked without a confirmed root cause so repair continues.
update public.qa_repair_requests
set status = 'pending',
    resolution = null,
    updated_at = now()
where status = 'blocked'
  and failure_class = 'app_lifecycle'
  and prior_requeues < 3
  and coalesce(resolution, '') !~ '^Confirmed root cause: ';

alter table public.qa_repair_requests
  drop constraint if exists qa_repair_requests_block_requires_root_cause;

alter table public.qa_repair_requests
  add constraint qa_repair_requests_block_requires_root_cause check (
    status <> 'blocked'
    or failure_class = 'security'
    or prior_requeues >= 3
    or coalesce(resolution, '') ~ '^Confirmed root cause: .{20,}'
  );

comment on constraint qa_repair_requests_block_requires_root_cause on public.qa_repair_requests is
  'App failures close as blocked only automatically or with a resolution starting "Confirmed root cause: " and its evidence.';
