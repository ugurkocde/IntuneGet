-- Find unchecked versions directly instead of scanning already processed history.
CREATE INDEX IF NOT EXISTS idx_version_history_pending_release_notes
ON public.version_history (created_at DESC, id DESC)
INCLUDE (winget_id, version)
WHERE release_notes_url_checked_at IS NULL;
