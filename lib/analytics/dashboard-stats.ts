import type { AnalyticsJob } from '@/lib/db/types';

export function aggregateDashboardStats(jobs: AnalyticsJob[], includeUsers: boolean, now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const counts = { totalDeployed: 0, thisMonth: 0, pending: 0, failed: 0 };
  const users = new Map<string, { userEmail: string; deployed: number; pending: number; failed: number }>();
  for (const job of jobs) {
    let person = users.get(job.user_id);
    if (!person) {
      person = { userEmail: job.user_email || 'Unknown user', deployed: 0, pending: 0, failed: 0 };
      users.set(job.user_id, person);
    }
    if (job.status === 'deployed' || job.status === 'completed') {
      counts.totalDeployed++; person.deployed++;
      const completed = Date.parse(job.completed_at ?? '');
      if (completed >= start && completed < end) counts.thisMonth++;
    } else if (job.status === 'failed') {
      counts.failed++; person.failed++;
    } else if (['queued', 'packaging', 'uploading'].includes(job.status)) {
      counts.pending++; person.pending++;
    }
  }
  const recentActivity = jobs.slice(0, 5).map(job => {
    const name = job.display_name || job.winget_id;
    const type: 'upload' | 'package' | 'error' = job.status === 'deployed' || job.status === 'uploading' ? 'upload' : ['failed', 'cancelled'].includes(job.status) ? 'error' : 'package';
    const status: 'success' | 'pending' | 'failed' = ['deployed', 'completed'].includes(job.status) ? 'success' : ['failed', 'cancelled'].includes(job.status) ? 'failed' : 'pending';
    const verb = ({ deployed: 'Deployed', completed: 'Packaged', failed: 'Failed to deploy', cancelled: 'Cancelled', queued: 'Queued', packaging: 'Packaging', uploading: 'Uploading' } as Record<string, string>)[job.status] ?? 'Processing';
    return { id: job.id, type, displayName: name, description: `${verb} ${name}`, timestamp: job.created_at, status, intuneAppUrl: job.intune_app_url ?? undefined, ...(includeUsers ? { deployedBy: job.user_email } : {}) };
  });
  return { ...counts, recentActivity, ...(includeUsers ? { perUser: [...users.values()].sort((a, b) => a.userEmail.localeCompare(b.userEmail)) } : {}) };
}
