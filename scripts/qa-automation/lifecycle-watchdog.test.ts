import {parseWatchdogResponse} from './lifecycle-watchdog.mjs';
import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';

function controller(runs:unknown[],demand=165,total=runs.length,lowDisk=false){
 const url=process.env.QA_CONTROLLER_TARGET || new URL('./qa-control.mjs',import.meta.url).href;
 const code=`const now=Date.parse('2026-11-14T19:30:00Z');Date.now=()=>now;const writes=[],calls=[];
 globalThis.__INTUNEQA_READ_TEST_OPTIONS__={now:()=>now,load:async()=>({version:2,responses:{},candidates:{},appCooldownUntil:0,unconfirmed:[]}),save:async()=>{},loadProvider:async()=>({getToken:async()=>'mock',revoke:async()=>[{revokedStatus:204}]})};globalThis.fetch=async(input,init={})=>{const u=new URL(input);calls.push(u.pathname);if(init.method&&init.method!=='GET'){writes.push(init.method);if(${lowDisk}&&init.method==='PATCH'&&u.pathname.endsWith('/qa_pipeline_control'))return Response.json([{id:'global'}]);throw Error('Unexpected mutation');}
 if(u.origin==='https://api.github.com')return Response.json({total_count:${total},workflow_runs:${JSON.stringify(runs)}});
 if(u.origin!=='https://mock.invalid')throw Error('Network escaped fixture');
 if(u.pathname.endsWith('/qa_pipeline_control'))return Response.json([{id:'global',paused:false,required_packager_commit:'a'.repeat(40),scheduler_packager_commit:'a'.repeat(40),scheduler_seen_at:new Date(now).toISOString()}]);
 if(init.headers?.Prefer==='count=exact')return new Response('[]',{headers:{'content-range':u.pathname.endsWith('/packaging_jobs')?'0-0/${demand}':'0-0/0'}});
 return Response.json([]);};process.argv=['node','controller',...(${lowDisk} ? ['--host-free-gb','1'] : [])];const results=[];const output=process.stdout.write.bind(process.stdout);process.stdout.write=x=>{results.push(JSON.parse(x));return true};const exit=process.exit;process.exit=code=>{output(JSON.stringify({results,writes,calls}));exit(code)};await import(${JSON.stringify(url)});output(JSON.stringify({results,writes,calls}));`;
 const r=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,NEXT_PUBLIC_SUPABASE_URL:'https://mock.invalid',SUPABASE_SERVICE_ROLE_KEY:'mock',CRON_SECRET:'mock',GITHUB_PAT:'mock',GITHUB_OWNER:'ugurkocde',GITHUB_WORKFLOWS_REPO:'IntuneGet-Workflows'}});
 expect(r.status,r.stderr+r.stdout).toBe(0);return JSON.parse(r.stdout);
}
describe('always-on completed-hour lifecycle watchdog',()=>{
 it('alerts on a fixture hour with zero lifecycle runs while customer jobs wait',()=>{const x=controller([]);expect(x.results[0].lifecycleWatchdog).toMatchObject({state:'alert',runs:0,awaitingQaJobs:165});expect(x.results[0].alerts).toEqual(expect.arrayContaining([expect.objectContaining({code:'qa_zero_lifecycle_hour'})]));expect(x.results[0].repairRequired).toBe(false);expect(x.writes).toEqual([]);});
 it('does not alert in a normal hour',()=>{const x=controller([{display_title:'Intune QA - Example.App 1 x64',created_at:'2026-11-14T18:20:00Z',status:'completed',conclusion:'success'}]);expect(x.results[0].lifecycleWatchdog).toMatchObject({state:'flowing',runs:1});expect(x.results[0].repairRequired).toBe(false);expect(x.writes).toEqual([]);});
 it('never turns an incomplete read into a zero alert and records its retry plan',()=>{const x=controller([],165,21);expect(x.results[0].lifecycleWatchdog).toMatchObject({state:'unknown',rejectCause:'incomplete_list'});expect(x.results[0].lifecycleWatchdog.retryPlan).toBeTruthy();expect(x.results[0].repairRequired).toBe(false);});
 it('does not read GitHub without waiting customers',()=>{const x=controller([],0);expect(x.results[0].lifecycleWatchdog).toMatchObject({state:'no_demand'});expect(x.calls.filter((p:string)=>p.includes('/actions/'))).toEqual([]);});
 it('does not count a current partial-hour run as progress in the completed hour',()=>{const x=controller([{display_title:'Intune QA - Example.App 1 x64',created_at:'2026-11-14T19:20:00Z',status:'in_progress',conclusion:null}]);expect(x.results[0].lifecycleWatchdog).toMatchObject({state:'alert',runs:0});});
});

it('retains the 512KiB raw guard before JSON parsing',()=>{expect(()=>parseWatchdogResponse(' '.repeat(512*1024+1))).toThrow('response_exceeds_512KiB');});
it('also guards UTF8 bytes for multibyte bodies',()=>{expect(()=>parseWatchdogResponse('é'.repeat(300000))).toThrow('response_exceeds_512KiB');});
it('rejects malformed JSON with a bounded cause',()=>{expect(()=>parseWatchdogResponse('{')).toThrow('invalid_json');});

it('low-disk early exit still records the zero-hour alert without starting repair',()=>{const x=controller([],165,0,true);expect(x.results[0].action).toBe('host_disk_low');expect(x.results[0].lifecycleWatchdog).toMatchObject({state:'alert',runs:0});expect(x.results[0].repairRequired).toBe(false);});
