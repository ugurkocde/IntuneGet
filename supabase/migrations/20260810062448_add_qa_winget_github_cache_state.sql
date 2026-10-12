alter table public.qa_winget_poll_state
  add column if not exists github_etag text,
  add column if not exists github_rate_limited_until timestamptz;

comment on column public.qa_winget_poll_state.github_etag is
  'GitHub commits endpoint ETag used for conditional WinGet change-feed requests.';
comment on column public.qa_winget_poll_state.github_rate_limited_until is
  'GitHub primary-rate-limit reset time; requests are deferred until this instant.';
