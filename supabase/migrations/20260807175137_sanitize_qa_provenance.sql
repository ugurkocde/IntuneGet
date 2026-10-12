-- QA run provenance remains in the private canonical repository only. Public
-- catalog rows expose a locale-neutral execution context and cannot retain run
-- IDs, test IDs, host names, or localized account names.
update public.qa_results
set
  environment = '{"executionContext":"LocalSystem"}'::jsonb,
  test_id = null,
  github_run_id = null,
  github_run_attempt = null;

alter table public.qa_results
  add constraint qa_results_public_provenance_sanitized
  check (
    test_id is null
    and github_run_id is null
    and github_run_attempt is null
    and (
      environment is null
      or environment = '{"executionContext":"LocalSystem"}'::jsonb
    )
  );

comment on column public.qa_results.environment is
  'Public locale-neutral execution context only; host and account provenance remain in the private canonical QA JSON.';
comment on column public.qa_results.test_id is
  'Reserved and constrained to null so private test provenance is not published.';
comment on column public.qa_results.github_run_id is
  'Reserved and constrained to null so private workflow provenance is not published.';
comment on column public.qa_results.github_run_attempt is
  'Reserved and constrained to null so private workflow provenance is not published.';
