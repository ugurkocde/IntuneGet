import { enrichCustomerQaStatus } from './customer-qa-status';
import type { PackagingJob } from '@/lib/db/types';
import { describeQaGateError, QaGateNotPassedError, QaSecurityGateError } from '@/lib/qa/gate';
const { state, from, holds, retries } = vi.hoisted(() => ({
  state: { configured: true, candidates: [] as Record<string, unknown>[], results: [] as Record<string, unknown>[], reputation: [] as Record<string, unknown>[], error: false },
  from: vi.fn(), holds: vi.fn(), retries: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ isSupabaseServerConfigured: () => state.configured, createServerClient: () => ({ from }) }));
vi.mock('@/lib/qa/installer-security-holds', () => ({ loadInstallerSecurityHolds: holds, installerSecurityReason: (n: number) => n === 0 ? 'VirusTotal: awaiting engine coverage, rechecking daily' : n === 1 ? 'VirusTotal: 1 engine flagged, rechecking daily' : 'VirusTotal refused execution for this installer hash.' }));
vi.mock('@/lib/qa/source-backoff', () => ({ qaSourceKey: (row: { id: string }) => row.id, qaSourceRetryAtMany: retries }));
const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const hash = 'a'.repeat(64), profile = 'b'.repeat(64);
const candidate = (patch = {}) => ({ id, winget_id: 'Example.App', version: '1.0', architecture: 'x64', installer_url: 'https://example.test/file.exe', installer_sha256: hash, package_profile_sha256: profile, status: 'queued', phase: null, next_retry_at: '-infinity', ...patch });
const job = (patch = {}) => ({ id: 'job1', status: 'awaiting_qa', qa_candidate_id: id, winget_id: 'Example.App', version: '1.0', architecture: 'x64', installer_sha256: hash, ...patch }) as PackagingJob;
beforeEach(() => {
  vi.clearAllMocks(); state.configured = true; state.error = false; state.candidates = [candidate()]; state.results = []; state.reputation = [];
  holds.mockResolvedValue(new Map()); retries.mockResolvedValue(new Map());
  from.mockImplementation((table: string) => {
    const q = { select: vi.fn(() => q), in: vi.fn(() => q), limit: vi.fn(() => q), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === 'qa_candidates' ? state.candidates : table === 'catalog_file_reputation' ? state.reputation : state.results, error: state.error ? { message: 'private engine RawEngine https://private.test?token=secret' } : null }).then(resolve) };
    return q;
  });
});
it('shows a real security hold and next check without returning internal evidence', async () => {
  holds.mockResolvedValue(new Map([[hash, { reason: 'VirusTotal: 1 engine flagged, rechecking daily', nextCheckAt: '2030-01-01T00:00:00Z', private: 'RawEngine' }]]));
  const [actual] = await enrichCustomerQaStatus([job()]);
  expect(actual.qa_status).toEqual({ category: 'installer_security_hold', message: expect.stringContaining('VirusTotal: 1 engine flagged'), nextEventAt: '2030-01-01T00:00:00.000Z' });
  expect(Object.keys(actual.qa_status!).sort()).toEqual(['category', 'message', 'nextEventAt']);
  expect(JSON.stringify(actual.qa_status)).not.toMatch(/RawEngine|[ab]{64}|private\.test|\u2013|\u2014/);
});
it('binds only authorized candidate ids and keeps similar jobs separate', async () => {
  state.candidates = [candidate(), candidate({ id: other, installer_sha256: 'c'.repeat(64) })];
  holds.mockResolvedValue(new Map([[hash, { reason: 'VirusTotal: awaiting engine coverage, rechecking daily', nextCheckAt: '2030-01-01' }]]));
  const rows = await enrichCustomerQaStatus([job(), job({ id: 'job2', qa_candidate_id: other, installer_sha256: 'c'.repeat(64) }), job({ id: 'done', status: 'deployed', qa_candidate_id: 'foreign' })]);
  expect(from.mock.results[0].value.in).toHaveBeenCalledWith('id', [id, other]);
  expect(rows[0].qa_status?.category).toBe('installer_security_hold'); expect(rows[1].qa_status?.category).toBe('queued'); expect(rows[2].qa_status).toBeUndefined();
});
it('uses source backoff and keeps security holds ahead of retry reasons', async () => {
  retries.mockResolvedValue(new Map([[id, '2030-02-01T00:00:00Z']]));
  expect((await enrichCustomerQaStatus([job()]))[0].qa_status).toMatchObject({ category: 'source_retry', nextEventAt: '2030-02-01T00:00:00.000Z' });
  holds.mockResolvedValue(new Map([[hash, { reason: 'VirusTotal: 1 engine flagged, rechecking daily', nextCheckAt: '2030-01-01' }]]));
  expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('installer_security_hold');
});
it('shows unknown reputation only for an exact published result tuple', async () => {
  state.results = [{ ...candidate(), tested_version: '1.0', virustotal_status: 'not_found', virustotal_malicious: 0, virustotal_suspicious: 0 }];
  expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('reputation_unknown');
  state.results[0].installer_sha256 = 'd'.repeat(64);
  expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('queued');
});
it('does not call a positive reputation result unknown', async () => {
  state.results = [{ ...candidate(), tested_version: '1.0', virustotal_status: 'flagged', virustotal_malicious: 1 }];
  expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('installer_security_hold');
});
it.each(['pending', 'not_found', 'error'])('ignores retired cache status %s when displaying current validation activity', async cacheStatus => {
  state.reputation = [{ sha256: hash, status: cacheStatus, malicious: null, suspicious: null, error: 'RawEngine secret' }];
  for (const [status, category] of [['running', 'testing'], ['queued', 'queued']]) {
    state.candidates = [candidate({ status })];
    const actual = (await enrichCustomerQaStatus([job()]))[0].qa_status;
    expect(actual?.category).toBe(category); expect(actual?.nextEventAt).toBeNull(); expect(JSON.stringify(actual)).not.toContain('RawEngine');
  }
});
it.each([{ winget_id: 'Other.App' }, { version: '2.0' }, { architecture: 'arm64' }, { installer_sha256: 'f'.repeat(64) }])('rejects stale or mismatched candidate evidence %j', async patch => {
  state.candidates = [candidate(patch)]; expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('unavailable');
});
it('distinguishes active testing and pending publication', async () => {
  state.candidates = [candidate({ status: 'running' })]; expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('testing');
  state.candidates = [candidate({ status: 'error', phase: 'publishing' })]; expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('publication');
});
it('keeps jobs usable when evidence fails or QA is not configured', async () => {
  state.error = true; expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('unavailable');
  state.configured = false; from.mockClear(); expect((await enrichCustomerQaStatus([job()]))[0].qa_status?.category).toBe('unavailable'); expect(from).not.toHaveBeenCalled();
});
it('does not query for completed jobs or invalid candidate ids', async () => {
  const done = job({ status: 'deployed' }); expect(await enrichCustomerQaStatus([done])).toEqual([done]);
  expect((await enrichCustomerQaStatus([job({ qa_candidate_id: 'untrusted' })]))[0].qa_status?.category).toBe('unavailable'); expect(from).not.toHaveBeenCalled();
});

const reputationMessage = (patch = {}) => describeQaGateError(new QaGateNotPassedError({
  wingetId: 'Example.App', version: '1.0', architecture: 'x64', installerSha256: hash,
  packageProfileSha256: profile, reason: 'reputation', ...patch,
}));
const recordedJob = (patch = {}) => job({ status_message: reputationMessage(), error_code: 'QA_NOT_PASSED_CURRENT_VERSION', ...patch });
function expectPrivateFree(status: unknown) {
  expect(JSON.stringify(status)).not.toMatch(/VirusTotal|engine|https?:|[a-f0-9]{64}|10000000-0000|\u2013|\u2014/i);
}
it.each(['QA_NOT_PASSED_CURRENT_VERSION', null])('preserves a recognized stored reputation reason when candidate has passed, code %s', async error_code => {
  state.candidates = [candidate({ status: 'passed' })];
  const status = (await enrichCustomerQaStatus([recordedJob({ error_code })]))[0].qa_status;
  expect(status).toMatchObject({ category: 'reputation_unknown', nextEventAt: null }); expectPrivateFree(status);
});
it.each(['missing id', 'query error', 'query exception', 'stale candidate', 'not configured'])('preserves the safe recorded reason through unavailable evidence: %s', async failure => {
  const patch = failure === 'missing id' ? { qa_candidate_id: null } : {};
  if (failure === 'query error') state.error = true;
  if (failure === 'query exception') from.mockImplementation(() => { throw Error('https://private.test?token=secret RawEngine'); });
  if (failure === 'stale candidate') state.candidates = [candidate({ version: '2.0' })];
  if (failure === 'not configured') state.configured = false;
  const status = (await enrichCustomerQaStatus([recordedJob(patch)]))[0].qa_status;
  expect(status?.category).toBe('reputation_unknown'); expectPrivateFree(status);
});
it.each([
  { status_message: reputationMessage({ reason: 'missing' }) },
  { status_message: describeQaGateError(new QaSecurityGateError({ wingetId: 'Example.App', version: '1.0', architecture: 'x64', malicious: 1, totalEngines: 68 })) },
  { status_message: reputationMessage({ wingetId: 'Other.App' }) },
  { status_message: reputationMessage({ version: '2.0' }) },
  { status_message: reputationMessage({ architecture: 'arm64' }) },
  { error_code: 'QA_SECURITY_FLAGGED_CURRENT_VERSION' },
  { status_message: reputationMessage() + ' ' },
  { status_message: reputationMessage() + ' https://private.test?token=secret' },
  { status_message: reputationMessage() + hash },
])('does not expose or reinterpret unrecognized stored text %j', async patch => {
  state.candidates = [candidate({ status: 'passed' })];
  const status = (await enrichCustomerQaStatus([recordedJob(patch)]))[0].qa_status;
  expect(status?.category).toBe('unavailable'); expectPrivateFree(status);
});
it('keeps live evidence ahead of a recorded reputation reason', async () => {
  state.candidates = [candidate({ status: 'running' })];
  expect((await enrichCustomerQaStatus([recordedJob()]))[0].qa_status?.category).toBe('testing');
  state.candidates = [candidate({ phase: 'publishing' })];
  expect((await enrichCustomerQaStatus([recordedJob()]))[0].qa_status?.category).toBe('publication');
  state.candidates = [candidate()];
  expect((await enrichCustomerQaStatus([recordedJob()]))[0].qa_status?.category).toBe('queued');
  retries.mockResolvedValue(new Map([[id, '2030-01-01T00:00:00Z']]));
  expect((await enrichCustomerQaStatus([recordedJob()]))[0].qa_status?.category).toBe('source_retry');
  holds.mockResolvedValue(new Map([[hash, { reason: 'VirusTotal: 1 engine flagged, rechecking daily', nextCheckAt: '2030-01-01' }]]));
  expect((await enrichCustomerQaStatus([recordedJob()]))[0].qa_status?.category).toBe('installer_security_hold');
});

it.each(['UPSTREAM_SOURCE_BACKOFF', 'UPSTREAM_METADATA_MISMATCH'])('shows a persisted upstream block with fixed public wording: %s', async error_code => {
  const blocked = job({ status: 'blocked_upstream', error_code, status_message: 'private https://private.test?token=secret ' + hash });
  const [actual] = await enrichCustomerQaStatus([blocked]);
  expect(actual.qa_status).toMatchObject({ category: 'blocked_upstream', reasonCode: error_code });
  expectPrivateFree(actual.qa_status);
  expect(actual.status).toBe('blocked_upstream');
});

const pretestMessage = 'A security check stopped this deployment before the installation test ran.';
const holdReason = (n: number) => n === 0 ? 'VirusTotal: awaiting engine coverage, rechecking daily' : n === 1 ? 'VirusTotal: 1 engine flagged, rechecking daily' : 'VirusTotal refused execution for this installer hash.';
const legacyHoldJob = (n = 0, patch = {}) => job({ status: 'qa_failed', execution_profile_sha256: profile, error_code: 'QA_FAILED_EXECUTION_PROFILE', error_message: holdReason(n), qa_completed_at: '2026-01-01T00:00:00Z', ...patch });
const setPretestHold = (n = 0) => {
 state.candidates = [candidate({ status: 'error', phase: 'scanning_installer' })];
 holds.mockResolvedValue(new Map([[hash, { reason: holdReason(n), nextCheckAt: '2030-01-01T00:00:00Z' }]]));
};
it.each([0,1])('annotates exact legacy pretest hold %i without changing stored state', async n => {
 setPretestHold(n); const input=legacyHoldJob(n); const [actual]=await enrichCustomerQaStatus([input]);
 expect(actual.qa_status).toEqual({category:'installer_security_hold',message:pretestMessage,nextEventAt:null});
 expectPrivateFree(actual.qa_status); expect(Object.keys(actual.qa_status!).sort()).toEqual(['category','message','nextEventAt']);
 const {qa_status,...stored}=actual; expect(stored).toEqual(input); expect(qa_status).toBeDefined();
});
it.each(['profile','candidate id','version','architecture','hash','phase null','phase queued','candidate status','no hold','two engines','failed result','error code','error message','invalid uuid'])('does not annotate a legacy mismatch: %s', async kind => {
 setPretestHold(); const patch: Record<string,unknown> = {};
 if(kind==='profile')patch.execution_profile_sha256='c'.repeat(64);
 if(kind==='candidate id')state.candidates=[candidate({id:other,status:'error',phase:'scanning_installer'})];
 if(['version','architecture','hash'].includes(kind)) state.candidates=[candidate({status:'error',phase:'scanning_installer',...(kind==='version'?{version:'2'}:kind==='architecture'?{architecture:'x86'}:{installer_sha256:'c'.repeat(64)})})];
 if(kind==='phase null'||kind==='phase queued') state.candidates=[candidate({status:'error',phase:kind==='phase null'?null:'queued'})];
 if(kind==='candidate status')state.candidates=[candidate({status:'failed',phase:'scanning_installer'})];
 if(kind==='no hold')holds.mockResolvedValue(new Map());
 if(kind==='two engines')holds.mockResolvedValue(new Map([[hash,{reason:holdReason(2),nextCheckAt:'2030-01-01'}]]));
 if(kind==='failed result')state.results=[{...candidate(),tested_version:'1.0',outcome:'Failed'}];
 if(kind==='error code')patch.error_code='OTHER_ERROR';
 if(kind==='error message')patch.error_message='The required installation test could not complete.';
 if(kind==='invalid uuid')patch.qa_candidate_id='invalid';
 const input=legacyHoldJob(0,patch);const [actual]=await enrichCustomerQaStatus([input]); expect(actual).toEqual(input);expect(actual.qa_status).toBeUndefined();
});
it.each(['query error','query exception','hold rejection','not configured'])('leaves legacy failure unchanged when evidence fails: %s', async kind=>{
 setPretestHold();if(kind==='query error')state.error=true;if(kind==='query exception')from.mockImplementation(()=>{throw Error('private error');});if(kind==='hold rejection')holds.mockRejectedValueOnce(Error('private error'));if(kind==='not configured')state.configured=false;
 const input=legacyHoldJob();expect(await enrichCustomerQaStatus([input])).toEqual([input]);
});
it('does not query for ineligible failed rows and handles a mixed authorized list',async()=>{
 const ineligible=legacyHoldJob(0,{error_code:'OTHER'});expect(await enrichCustomerQaStatus([ineligible])).toEqual([ineligible]);expect(from).not.toHaveBeenCalled();
 setPretestHold();const [waiting,failed]=await enrichCustomerQaStatus([job(),legacyHoldJob()]);expect(waiting.qa_status?.category).toBe('installer_security_hold');expect(failed.qa_status?.message).toBe(pretestMessage);
});

const versionUnavailableMessage = 'This app version is not available for automated deployment.';
const appUnavailableMessage = 'This app is not available for automated deployment.';
const unavailableLegacyJob = (patch = {}) => job({ id:'unavailable-job',status:'qa_failed',qa_candidate_id:null,error_code:'QA_FAILED_EXECUTION_PROFILE',error_message:versionUnavailableMessage,...patch });
it('explains the exact recorded ARM64 pre-candidate refusal without changing the stored job', async () => {
 const input=unavailableLegacyJob({architecture:'arm64',error_message:'This app is not currently available for deployment.'});
 const [actual]=await enrichCustomerQaStatus([input]);
 expect(actual.qa_status).toEqual({category:'unavailable',reasonCode:'ARCHITECTURE_UNAVAILABLE',message:'Automated deployment is not available for this app architecture.',nextEventAt:null});
 const {qa_status,...stored}=actual;expect(stored).toEqual(input);expect(qa_status).toBeDefined();expect(from).not.toHaveBeenCalled();
});
it.each(['ARM64','Arm64',' arm64 '])('recognizes the producer architecture normalization for %s',async architecture=>{
 const input=unavailableLegacyJob({architecture,error_message:'This app is not currently available for deployment.'});
 const [actual]=await enrichCustomerQaStatus([input]);
 expect(actual.qa_status?.reasonCode).toBe('ARCHITECTURE_UNAVAILABLE');
 const {qa_status,...stored}=actual;expect(stored).toEqual(input);expect(qa_status).toBeDefined();expect(from).not.toHaveBeenCalled();
});
it.each([
 {architecture:'x64'}, {architecture:'x86'}, {architecture:'arm64x'}, {qa_candidate_id:id}, {qa_candidate_id:undefined},
 {error_code:'OTHER'}, {status:'failed'}, {error_message:'This app is not currently available for deployment. '},
])('does not infer an architecture refusal from a lookalike %j',async patch=>{
 const input=unavailableLegacyJob({architecture:'arm64',error_message:'This app is not currently available for deployment.',...patch});
 expect(await enrichCustomerQaStatus([input])).toEqual([input]);expect(from).not.toHaveBeenCalled();
});
it('retains the recorded architecture display when unrelated waiting evidence is unavailable',async()=>{
 state.error=true;
 const input=unavailableLegacyJob({architecture:'arm64',error_message:'This app is not currently available for deployment.'});
 const [actual]=await enrichCustomerQaStatus([input,job()]);
 expect(actual.qa_status?.reasonCode).toBe('ARCHITECTURE_UNAVAILABLE');
 const {qa_status,...stored}=actual;expect(stored).toEqual(input);expect(qa_status).toBeDefined();
});
it.each([[versionUnavailableMessage,'VERSION_UNAVAILABLE'],[appUnavailableMessage,'PACKAGE_UNAVAILABLE']])('annotates only the exact unavailable cause %s',async(message,code)=>{
 const input=unavailableLegacyJob({error_message:message});const [actual]=await enrichCustomerQaStatus([input]);
 expect(actual.qa_status).toEqual({category:'unavailable',reasonCode:code,message,nextEventAt:null});
 const {qa_status,...stored}=actual;expect(stored).toEqual(input);expect(qa_status).toBeDefined();expect(from).not.toHaveBeenCalled();expect(holds).not.toHaveBeenCalled();
});
it.each([
 ['linked candidate',{qa_candidate_id:id}],['missing candidate',{qa_candidate_id:undefined}],
 ['compatibility code',{error_code:'QA_PACKAGE_COMPATIBILITY_BLOCKED'}],['missing code',{error_code:null}],['other code',{error_code:'OTHER'}],
 ['trailing space',{error_message:versionUnavailableMessage+' '}],['different case',{error_message:versionUnavailableMessage.toLowerCase()}],
 ['architecture',{error_message:'This app architecture is not available for automated deployment.'}],['generic failure',{error_message:'This app did not pass the isolated installation test.'}],
 ['different status',{status:'failed'}],
])('keeps an unavailable lookalike unchanged: %s',async(_kind,patch)=>{
 const input=unavailableLegacyJob(patch);expect(await enrichCustomerQaStatus([input])).toEqual([input]);expect(from).not.toHaveBeenCalled();
});
it('keeps unavailable, waiting and exact security evidence separate in a mixed list',async()=>{
 setPretestHold();const [unavailable,waiting,failed]=await enrichCustomerQaStatus([unavailableLegacyJob(),job({id:'waiting-job'}),legacyHoldJob()]);
 expect(unavailable.qa_status?.reasonCode).toBe('VERSION_UNAVAILABLE');expect(waiting.qa_status?.category).toBe('installer_security_hold');expect(failed.qa_status?.message).toBe(pretestMessage);
 expect(from.mock.results[0].value.in).toHaveBeenCalledWith('id',[id]);
});
it.each(['query error','query exception'])('preserves pure availability annotation through the waiting fallback: %s',async kind=>{
 if(kind==='query error')state.error=true;else from.mockImplementation(()=>{throw Error('private failure');});
 const input=unavailableLegacyJob();const [actual,waiting]=await enrichCustomerQaStatus([input,job()]);
 expect(actual.qa_status).toEqual({category:'unavailable',reasonCode:'VERSION_UNAVAILABLE',message:versionUnavailableMessage,nextEventAt:null});
 const {qa_status,...stored}=actual;expect(stored).toEqual(input);expect(qa_status).toBeDefined();expect(waiting.qa_status?.category).toBe('unavailable');
});

it('preserves the byte-identical waiting display when a legacy failure joins its batch', async () => {
  const waiting = job({ id: 'waiting', qa_candidate_id: other, installer_sha256: 'c'.repeat(64) });
  state.candidates = [candidate({ id: other, installer_sha256: 'c'.repeat(64) })];
  const [alone] = await enrichCustomerQaStatus([waiting]);
  state.candidates.push(candidate({ status: 'error', phase: 'scanning_installer' }));
  holds.mockResolvedValue(new Map([[hash, { reason: holdReason(0), nextCheckAt: '2030-01-01' }]]));
  const [, batched] = await enrichCustomerQaStatus([legacyHoldJob(), waiting]);
  expect(JSON.stringify(batched)).toBe(JSON.stringify(alone));
});

it('leaves legacy failures unannotated without querying above the 50 id bound', async () => {
  const inputs = Array.from({ length: 51 }, (_, index) => legacyHoldJob(0, {
    id: `job-${index}`, qa_candidate_id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  }));
  expect(await enrichCustomerQaStatus(inputs)).toEqual(inputs);
  expect(from).not.toHaveBeenCalled();
});
