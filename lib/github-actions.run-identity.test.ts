import {afterEach,describe,expect,it,vi} from 'vitest';
import {findPackagingWorkflowRun,WorkflowReadRateLimitError,type GitHubActionsConfig} from './github-actions';
const config: GitHubActionsConfig={token:'fixture',owner:'example',repo:'product',workflowsRepo:'workflows',workflowFile:'package-intunewin.yml',ref:'refs/heads/main'};
const job='4a4f09e2-cc56-4ad2-a264-38b8f91e79c7',started='2026-01-01T00:00:00.000Z';
const run=(overrides: Record<string,unknown>={})=>({id:42,status:'completed',conclusion:'failure',created_at:started,updated_at:started,
  repository:{full_name:'example/workflows'},path:'.github/workflows/package-intunewin.yml',event:'repository_dispatch',run_attempt:1,
  display_title:`Package ${job}`,head_branch:'main',...overrides});
afterEach(()=>vi.unstubAllGlobals());
describe('missing packaging run identity',()=>{
 it('finds the exact job within a bounded historical window without dispatching',async()=>{
  const request=vi.fn(async()=>Response.json({total_count:1,workflow_runs:[run()]}));vi.stubGlobal('fetch',request);
  expect(await findPackagingWorkflowRun(job,started,config)).toEqual({id:42});
  expect(request).toHaveBeenCalledTimes(1);const [url,options]=request.mock.calls[0] as unknown as [string,RequestInit];
  const u=new URL(url);expect(u.pathname).toBe('/repos/example/workflows/actions/workflows/package-intunewin.yml/runs');
  expect(u.searchParams.get('created')).toBe('2025-12-31T23:59:00.000Z..2026-01-01T00:10:00.000Z');
  expect(u.searchParams.get('branch')).toBe('main');expect(u.searchParams.get('event')).toBe('repository_dispatch');
  expect(options).toMatchObject({redirect:'error',signal:expect.any(AbortSignal)});expect(options.method).toBeUndefined();
 });
 it.each([{display_title:'Package other-job'},{repository:{full_name:'other/workflows'}},{head_branch:'other'},{run_attempt:2},
  {event:'workflow_dispatch'},{path:'.github/workflows/intune-qa.yml'},{created_at:'2026-01-01T01:00:00Z'}])('rejects lookalike attribution %j',async override=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({total_count:1,workflow_runs:[run(override)]})));
  expect(await findPackagingWorkflowRun(job,started,config)).toBeNull();
 });
 it.each(['two matches','duplicate page ids','changed page count','incomplete page','too many'])('rejects incomplete or ambiguous evidence: %s',async reason=>{
  const request=vi.fn(async(input:string)=>{
   const second=new URL(input).searchParams.get('page')==='2';
   if(reason==='two matches')return Response.json({total_count:2,workflow_runs:[run(),run({id:43})]});
   if(reason==='too many')return Response.json({total_count:201,workflow_runs:[run()]});
   const first=Array.from({length:100},(_,n)=>run({id:n+100,display_title:'Package other-job'}));
   return Response.json({total_count:second&&reason==='changed page count'?102:101,
    workflow_runs:second?(reason==='incomplete page'?[]:[reason==='duplicate page ids'?first[0]:run()]):first});
  });vi.stubGlobal('fetch',request);expect(await findPackagingWorkflowRun(job,started,config)).toBeNull();expect(request.mock.calls.length).toBeLessThanOrEqual(2);
 });
 it('uses the second complete page when the exact run is older',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>Response.json({total_count:101,workflow_runs:new URL(input).searchParams.get('page')==='2'?[run()]:Array.from({length:100},(_,n)=>run({id:n+100,display_title:'Package other-job'}))})));
  expect(await findPackagingWorkflowRun(job,started,config)).toEqual({id:42});
 });
 it('stops on quota refusal without forwarding provider text',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('private upstream details',{status:429,headers:{'retry-after':'60'}})));
  await expect(findPackagingWorkflowRun(job,started,config)).rejects.toBeInstanceOf(WorkflowReadRateLimitError);
 });
 it('makes no request for a missing dispatch timestamp or invalid job',async()=>{
  const request=vi.fn();vi.stubGlobal('fetch',request);
  expect(await findPackagingWorkflowRun(job,'invalid',config)).toBeNull();expect(await findPackagingWorkflowRun('invalid',started,config)).toBeNull();expect(request).not.toHaveBeenCalled();
 });
});
