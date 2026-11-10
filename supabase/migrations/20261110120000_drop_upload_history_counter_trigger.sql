-- apps_deployed is maintained by packaging_jobs_track_apps_deployed
-- (20261110093000). An older trigger on upload_history, created outside the
-- migrations, also added 1 for every upload, so each deployment was counted
-- twice after that migration.

drop trigger if exists on_upload_history_insert on public.upload_history;
drop function if exists public.increment_apps_deployed();

update public.site_counters
set value = (select count(*) from public.packaging_jobs where status = 'deployed'),
    updated_at = now()
where id = 'apps_deployed';
