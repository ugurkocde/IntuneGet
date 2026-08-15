-- Split heuristic "suspicious" verdicts from confirmed "flagged" (malicious)
-- verdicts. A flagged status now always means at least one vendor rated the
-- installer malicious, which is what blocks packaging; suspicious-only
-- verdicts remain informational warnings.
alter table public.qa_results
  drop constraint if exists qa_results_virustotal_status_check;
alter table public.qa_results
  add constraint qa_results_virustotal_status_check check (
    virustotal_status is null or virustotal_status in (
      'clean', 'suspicious', 'flagged', 'not_found', 'error', 'skipped'
    )
  );

alter table public.qa_package_results
  drop constraint if exists qa_package_results_virustotal_status_check;
alter table public.qa_package_results
  add constraint qa_package_results_virustotal_status_check check (
    virustotal_status is null or virustotal_status in (
      'clean', 'suspicious', 'flagged', 'not_found', 'error', 'skipped'
    )
  );
