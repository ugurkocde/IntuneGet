-- Daily held-installer checks compare normalized hashes and rank each hash by
-- its highest candidate priority, including historical/non-PSADT candidates.
-- A full index serves both that ranking and the separate eligibility probe.
set local lock_timeout = '2s';
create index qa_candidates_installer_priority_lookup_idx
  on public.qa_candidates (lower(installer_sha256), priority)
  include (test_level, status);
analyze public.qa_candidates;
