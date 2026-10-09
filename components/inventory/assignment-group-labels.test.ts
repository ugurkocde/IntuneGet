// @vitest-environment happy-dom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({app:null as unknown}));
vi.mock('@/hooks/use-inventory',()=>({useAppDetails:()=>({data:{app:state.app},isLoading:false,error:null,refetch:vi.fn()})}));
vi.mock('@/components/dashboard/animations/SlidePanel',()=>({SlidePanel:({children}:{children:React.ReactNode})=>children}));
import {InventoryAppDetails} from './InventoryAppDetails';
let root:Root;
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(async()=>{await act(async()=>root?.unmount());document.body.innerHTML='';vi.unstubAllGlobals();});
async function render(excluded=false,name?:string){
  const id='11111111-1111-4111-8111-111111111111';
  state.app={id:'fixture-app',displayName:'Fixture',publisher:'Example',createdDateTime:'2026-01-01T00:00:00Z',lastModifiedDateTime:'2026-01-01T00:00:00Z',installExperience:{runAsAccount:'system'},assignments:[{id:'assignment',intent:'required',target:{'@odata.type':`#microsoft.graph.${excluded?'exclusionGroupAssignmentTarget':'groupAssignmentTarget'}`,groupId:id},settings:null}],assignmentGroupNames:name?{[id]:name}:undefined};
  vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Network forbidden in renderer regression');}));
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(createElement(InventoryAppDetails,{appId:'fixture-app',onClose:vi.fn()})));return container.textContent;
}
describe('actual inventory assignment rendering',()=>{
  it('shows a resolved assignment name',async()=>{expect(await render(false,'Fixture Group')).toContain('Group: Fixture Group');expect(fetch).not.toHaveBeenCalled();});
  it('keeps ID fallback for old cached responses',async()=>{expect(await render()).toContain('Group: 11111111...');});
  it('identifies excluded groups',async()=>{expect(await render(true,'Finance')).toContain('Excluded group: Finance');});
  it('renders group names as text',async()=>{expect(await render(false,'<img src=x onerror=alert(1)>')).toContain('<img src=x onerror=alert(1)>');expect(document.querySelector('img')).toBeNull();});
});
