-- Cover the existing case-insensitive supersession check without changing it.
create index qa_candidates_terminal_newer_idx
  on public.qa_candidates (lower(winget_id), architecture, enqueued_at);
