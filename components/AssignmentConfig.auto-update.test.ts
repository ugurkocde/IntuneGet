// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AssignmentConfig } from './AssignmentConfig';
import type { PackageAssignment } from '@/types/upload';
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({getAccessToken:async()=> 'fake-token'}) }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({isMspUser:false,selectedTenantId:null}) }));
let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(async()=>{await act(async()=>root?.unmount());document.body.innerHTML='';vi.unstubAllGlobals();});
async function render(a:PackageAssignment[],supported=true) {
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({filters:[]})})));
  const node=document.createElement('div');document.body.append(node);root=createRoot(node);const change=vi.fn();
  await act(async()=>root.render(createElement(AssignmentConfig,{assignments:a,onChange:change,supportsAutoUpdateSuperseded:supported})));
  const settings=[...document.querySelectorAll('button')].find(b=>b.title.startsWith('Assignment settings'));
  if(settings)await act(async()=>settings.click());
  return change;
}
it('offers an unchecked choice for each Available include assignment',async()=>{
  const change=await render([{type:'allUsers',intent:'available'}]);
  const input=document.querySelector<HTMLInputElement>('input[type=checkbox][aria-label="Automatically update superseded app versions"]');
  expect(input).not.toBeNull();expect(input!.checked).toBe(false);
  await act(async()=>input!.click());
  expect(change).toHaveBeenLastCalledWith([{type:'allUsers',intent:'available',autoUpdateSupersededApps:true}]);
});
it.each(['required','uninstall','updateOnly'] as const)('hides the option for %s',async intent=>{
  await render([{type:'allUsers',intent}]);expect(document.body.textContent).not.toContain('Automatically update superseded app versions');
});
it('hides the option for Store callers',async()=>{
  await render([{type:'allUsers',intent:'available'}],false);expect(document.body.textContent).not.toContain('Automatically update superseded app versions');
});
