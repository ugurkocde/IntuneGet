ALTER TABLE public.app_update_policies
  ADD COLUMN auto_update_scope text NOT NULL DEFAULT 'all'
  CHECK (auto_update_scope IN ('all', 'minor', 'major'));
