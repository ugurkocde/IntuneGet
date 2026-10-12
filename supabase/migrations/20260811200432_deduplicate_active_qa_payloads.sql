-- A QA pass belongs to an immutable installer payload. Keep only one queued
-- or executing PSADT-package candidate for that payload, even when concurrent
-- customer requests carry different presentation/configuration profiles.
with ranked_active as (
  select
    id,
    status,
    row_number() over (
      partition by
        lower(winget_id),
        version,
        lower(architecture),
        upper(installer_sha256)
      order by
        case status
          when 'running' then 0
          when 'dispatched' then 1
          else 2
        end,
        priority desc,
        enqueued_at asc,
        id asc
    ) as payload_rank
  from public.qa_candidates
  where test_level = 'psadt-package'
    and status in ('queued', 'dispatched', 'running')
)
update public.qa_candidates as candidate
set
  status = 'superseded',
  failure_summary = 'Superseded by another active test for the same app payload.',
  updated_at = now()
from ranked_active
where candidate.id = ranked_active.id
  and ranked_active.payload_rank > 1
  and ranked_active.status = 'queued';

create unique index if not exists qa_candidates_one_active_payload_idx
  on public.qa_candidates (
    lower(winget_id),
    version,
    lower(architecture),
    upper(installer_sha256)
  )
  where test_level = 'psadt-package'
    and status in ('queued', 'dispatched', 'running');
