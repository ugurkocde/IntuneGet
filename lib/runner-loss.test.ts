import { describe, expect, it } from 'vitest';
import { classifyRunnerLoss, type RunnerLossJob, type PackagingWorkflowRun, type WorkflowAttemptJobs } from './runner-loss';

const expected = { owner: 'ugurkocde', workflowsRepo: 'IntuneGet-Workflows', workflowFile: 'package-intunewin.yml', ref: 'main' };
const started = '2026-11-10T10:00:00Z';
const job: RunnerLossJob = { id: '4a4f09e2-cc56-4ad2-a264-38b8f91e79c7', status: 'packaging', github_run_id: '42',
  packaging_started_at: started, infrastructure_retry_count: 0, qa_candidate_id: 'candidate', execution_profile_sha256: 'a'.repeat(64),
  package_config: {}, intune_app_id: null, cancelled_at: null, archived_at: null };
const run: PackagingWorkflowRun = { id: 42, repository: { full_name: 'ugurkocde/IntuneGet-Workflows' },
  path: '.github/workflows/package-intunewin.yml', event: 'repository_dispatch', run_attempt: 1, head_branch: 'main',
  display_title: `Package ${job.id}`, created_at: started, updated_at: started, status: 'completed', conclusion: 'failure' };
// Shape and annotation confirmed from the reported historical run. IDs and time are synthetic.
const attempt: WorkflowAttemptJobs = { total_count: 1, jobs: [{ id: 101, run_id: 42, run_attempt: 1,
  status: 'completed', conclusion: 'failure', steps: [] }] };
const annotations = [{ message: 'The self-hosted runner lost communication with the server. Verify the machine is running and has a healthy network connection.' }];
const classify = (j = job, r = run, a = attempt, notes = annotations, count = 1) => classifyRunnerLoss(j, r, a, notes, expected, count);

describe('customer runner loss safety proof', () => {
  it('admits one fresh QA-gated retry only with exact identity and zero steps', () => expect(classify()).toBe('retry_eligible'));
  it('never retries once even setup has started', () => expect(classify(job, run, { ...attempt, jobs: [{ ...attempt.jobs[0], steps: [{ name: 'Set up job' }] }] })).toBe('terminal_steps_ran'));
  it('does not interpret missing steps as an empty list', () => expect(classify(job, run, { ...attempt, jobs: [{ ...attempt.jobs[0], steps: undefined }] })).toBe('ambiguous'));
  it('refuses truncated job evidence', () => expect(classify(job, run, { ...attempt, total_count: 2 })).toBe('ambiguous'));
  it('refuses an empty jobs response', () => expect(classify(job, run, { total_count: 0, jobs: [] })).toBe('ambiguous'));
  it('refuses duplicate job IDs', () => expect(classify(job, run, { total_count: 2, jobs: [attempt.jobs[0], attempt.jobs[0]] })).toBe('ambiguous'));
  it.each([
    { id: 43 }, { repository: { full_name: 'other/repo' } }, { path: '.github/workflows/intune-qa.yml' },
    { event: 'workflow_dispatch' }, { run_attempt: 2 }, { display_title: `${run.display_title} extra` },
    { head_branch: 'other' }, { created_at: '2026-11-09T00:00:00Z' }, { created_at: 'invalid' },
  ])('refuses an unbound run %j', patch => expect(classify(job, { ...run, ...patch })).toBe('ambiguous'));
  it('refuses a mismatched attempt job', () => expect(classify(job, run, { ...attempt, jobs: [{ ...attempt.jobs[0], run_attempt: 2 }] })).toBe('ambiguous'));
  it('refuses a job still running', () => expect(classify(job, run, { ...attempt, jobs: [{ ...attempt.jobs[0], status: 'in_progress' }] })).toBe('ambiguous'));
  it('leaves successful runs without callbacks on the existing stale path', () => expect(classify(job, { ...run, conclusion: 'success' })).toBe('pending'));
  it('leaves in-progress runs alone', () => expect(classify(job, { ...run, status: 'in_progress' })).toBe('pending'));
  it('does not invent a runner-loss reason', () => expect(classify(job, run, attempt, [])).toBe('terminal_no_steps'));
  it('does not retry cancellation', () => expect(classify(job, { ...run, conclusion: 'cancelled' })).toBe('terminal_no_steps'));
  it.each([
    { infrastructure_retry_count: 1 }, { infrastructure_retry_count: undefined }, { infrastructure_retry_count: -1 },
    { status: 'uploading' }, { qa_candidate_id: null }, { execution_profile_sha256: null },
    { package_config: { forceCreate: true } }, { intune_app_id: 'existing-app' },
    { cancelled_at: started }, { archived_at: started },
  ])('never retries an ineligible customer job %j', patch => expect(classify({ ...job, ...patch })).toBe('terminal_no_steps'));
  it('refuses a shared run ID', () => expect(classify(job, run, attempt, annotations, 2)).toBe('terminal_no_steps'));
});
