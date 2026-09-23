import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { auditQaCohort } from '@/lib/qa/cohort';

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = createServerClient();
  // Only service-role callers can read evidence; return aggregate counts, never customer configuration.
  async function all(query: (start: number, end: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
    const result: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 200) {
      const { data, error } = await query(offset, offset + 199);
      if (error) throw new Error(error.message);
      const page = data as Record<string, unknown>[];
      result.push(...page);
      if (page.length < 200) return result;
    }
  }
  const [candidates, results, deployed, appBlocks, excluded, payloads] = await Promise.all([
    all((s,e) => db.from('qa_candidates').select('id,winget_id,version,architecture,status,test_level,installer_sha256,package_profile_sha256,finished_at,test_config,github_run_id').eq('status','passed').eq('test_level','psadt-package').order('id').range(s,e)),
    all((s,e) => db.from('qa_package_results').select('winget_id,tested_version,architecture,installer_sha256,package_profile_sha256,outcome,phase_results,environment,packager_commit,tested_at_utc,virustotal_status,virustotal_malicious,virustotal_suspicious,github_run_id').eq('outcome','Passed').order('package_profile_sha256').range(s,e)),
    all((s,e) => db.from('upload_history').select('winget_id').order('id').range(s,e)),
    all((s,e) => db.from('package_eligibility_blocks').select('winget_id').order('winget_id').range(s,e)),
    all((s,e) => db.from('curated_excluded_apps').select('winget_id').order('winget_id').range(s,e)),
    all((s,e) => db.from('qa_package_blocks').select('winget_id,version,architecture,installer_sha256').order('winget_id').order('version').order('architecture').order('installer_sha256').range(s,e)),
  ]);
  return NextResponse.json({ observedAtUtc: new Date().toISOString(), cohort: auditQaCohort({
    candidates, results, deployedIds: deployed.map(r => String(r.winget_id)),
    blockedIds: [...appBlocks, ...excluded].map(r => String(r.winget_id)), blockedPayloads: payloads,
  }) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const maxDuration = 300;
