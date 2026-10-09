import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignmentTargetLabel, resolveAssignmentGroupNames } from './assignment-group-names';
import type { IntuneAppAssignment } from '@/types/inventory';
const id='11111111-1111-4111-8111-111111111111';
const assignment=(groupId=id,excluded=false):IntuneAppAssignment=>({id:'assignment',intent:'required',settings:null,target:{'@odata.type':`#microsoft.graph.${excluded?'exclusionGroupAssignmentTarget':'groupAssignmentTarget'}`,groupId}});
const signal=()=>new AbortController().signal;
afterEach(()=>vi.unstubAllGlobals());
describe('assignment group name resolution',()=>{
  it('uses the same token and preserves the assignment while resolving a duplicate once',async()=>{
    const input=[assignment(),assignment(id.toUpperCase(),true)],before=structuredClone(input);
    const fetchMock=vi.fn().mockResolvedValue(Response.json({id,displayName:'Fixture Group'}));vi.stubGlobal('fetch',fetchMock);
    expect(await resolveAssignmentGroupNames(input,'fixture-token',signal())).toEqual({[id]:'Fixture Group'});
    expect(input).toEqual(before);expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`https://graph.microsoft.com/v1.0/groups/${id}?$select=id,displayName`,expect.objectContaining({headers:{Authorization:'Bearer fixture-token'},cache:'no-store'}));
  });
  it.each([403,404,429,500])('falls back without retry on %i',async status=>{
    const mock=vi.fn().mockResolvedValue(new Response(null,{status}));vi.stubGlobal('fetch',mock);
    expect(await resolveAssignmentGroupNames([assignment()],'token',signal())).toEqual({});expect(mock).toHaveBeenCalledTimes(1);
  });
  it.each([{id,displayName:''},{id,displayName:'  '},{id:'other',displayName:'Wrong tenant'},{id,displayName:42}])('rejects unexpected group responses %j',async body=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(body)));
    expect(await resolveAssignmentGroupNames([assignment()],'token',signal())).toEqual({});
  });
  it('does not look up invalid IDs or special targets',async()=>{
    const mock=vi.fn();vi.stubGlobal('fetch',mock);
    const input=[assignment('../users'),...['allDevicesAssignmentTarget','allLicensedUsersAssignmentTarget'].map(type=>({...assignment(),target:{'@odata.type':'#microsoft.graph.'+type,groupId:id}}))];
    expect(await resolveAssignmentGroupNames(input,'token',signal())).toEqual({});expect(mock).not.toHaveBeenCalled();
  });
  it('handles malformed JSON and thrown requests',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('invalid')));expect(await resolveAssignmentGroupNames([assignment()],'token',signal())).toEqual({});
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('timeout')));expect(await resolveAssignmentGroupNames([assignment()],'token',signal())).toEqual({});
  });
  it('caps lookups at50 and concurrency at5',async()=>{
    let active=0,max=0;const mock=vi.fn(async(url:string)=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;return Response.json({id:url.split('/groups/')[1].split('?')[0],displayName:'Group'});});vi.stubGlobal('fetch',mock);
    const input=Array.from({length:51},(_,i)=>assignment(`${i.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`));
    expect(Object.keys(await resolveAssignmentGroupNames(input,'token',signal()))).toHaveLength(50);expect(mock).toHaveBeenCalledTimes(50);expect(max).toBe(5);
  });
  it('does not reuse names across tokens or requests',async()=>{
    const mock=vi.fn(async(_url:string,options:RequestInit)=>Response.json({id,displayName:(options.headers as Record<string,string>).Authorization}));vi.stubGlobal('fetch',mock);
    expect(await resolveAssignmentGroupNames([assignment()],'tenant-a',signal())).toEqual({[id]:'Bearer tenant-a'});
    expect(await resolveAssignmentGroupNames([assignment()],'tenant-b',signal())).toEqual({[id]:'Bearer tenant-b'});expect(mock).toHaveBeenCalledTimes(2);
  });
  it('does no work when the caller is already aborted',async()=>{
    const mock=vi.fn();vi.stubGlobal('fetch',mock);const controller=new AbortController();controller.abort();
    expect(await resolveAssignmentGroupNames([assignment()],'token',controller.signal)).toEqual({});expect(mock).not.toHaveBeenCalled();
  });
  it('labels includes, exclusions and unresolved groups without altering special targets',()=>{
    expect(assignmentTargetLabel(assignment().target,{[id]:'Finance'})).toBe('Group: Finance');
    expect(assignmentTargetLabel(assignment(id,true).target,{[id]:'Finance'})).toBe('Excluded group: Finance');
    expect(assignmentTargetLabel(assignment().target)).toBe('Group: 11111111...');
    expect(assignmentTargetLabel({'@odata.type':'#microsoft.graph.allDevicesAssignmentTarget'})).toBe('All Devices');
    expect(assignmentTargetLabel({'@odata.type':'#microsoft.graph.allUsersAssignmentTarget'})).toBe('All Users');
  });
});
