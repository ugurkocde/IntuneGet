-- Previously seeded hashes inside the recorded-date window are recent work, not historical backfill.
UPDATE public.catalog_file_reputation r SET priority=2
WHERE queued_at IS NOT NULL AND status IN ('pending','error')
  AND EXISTS(SELECT 1 FROM public.version_history v WHERE lower(v.installer_sha256)=r.sha256
    AND v.created_at>=now()-interval '72 hours' AND v.created_at<=now());
