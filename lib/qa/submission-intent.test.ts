import { afterEach, expect, it, vi } from 'vitest';
import { dispatchQaCandidate, type QaDispatchCandidate } from './dispatch';
const { preflight, rpc, server }=vi.hoisted(()=>({preflight:vi.fn(),rpc:vi.fn(),server:vi.fn()}));
vi.mock('@/lib/installer-preflight',()=>({enforceInstallerPreflight:preflight}));
vi.mock('@/lib/supabase',()=>({getServerClientOrNull:server}));
vi.mock('@/lib/github-actions',()=>({getGitHubActionsConfig:()=>({owner:'example',workflowsRepo:'workflows',ref:'main',token:'fixture-only'})}));
const candidate:QaDispatchCandidate={id:'11111111-1111-4111-8111-111111111111',winget_id:'Example.App',version:'1',architecture:'x64',installer_url:'https://example.test/public.exe',installer_sha256:'A'.repeat(64),installer_file_name:'public.exe',installer_type:'exe',definition_path:null,test_level:'psadt-package',package_profile_sha256:'B'.repeat(64),test_config:{mode:'psadt-package'}};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();preflight.mockReset();rpc.mockReset();server.mockReset();});
it.each(['live','cache'])('records server %s provenance before GitHub dispatch',async source=>{
  preflight.mockResolvedValue({status:'healthy',source,cacheKey:'verified'});server.mockReturnValue({rpc});
  const fetchMock=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal('fetch',fetchMock);
  rpc.mockImplementation(async()=>{expect(fetchMock).not.toHaveBeenCalled();return {error:null};});
  await dispatchQaCandidate(candidate);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('record_qa_vt_submission_intent',{p_candidate_id:candidate.id,p_cache_key:'verified',p_execution_url:candidate.installer_url});
  expect(fetchMock).toHaveBeenCalledOnce();
});
it.each(['Custom.Private','intuneget.curated.app'])('never records upload provenance for %s',async winget_id=>{
  preflight.mockResolvedValue({status:'healthy',source:'live',cacheKey:'verified'});server.mockReturnValue({rpc});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(null,{status:204})));
  await dispatchQaCandidate({...candidate,winget_id});expect(rpc).not.toHaveBeenCalled();
});
it('continues dispatch without upload rights when the optional intent RPC fails',async()=>{
  preflight.mockResolvedValue({status:'healthy',source:'live',cacheKey:'verified'});server.mockReturnValue({rpc});rpc.mockRejectedValue(new Error('fixture transport failure'));
  vi.spyOn(console,'warn').mockImplementation(()=>{});const fetchMock=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal('fetch',fetchMock);
  await dispatchQaCandidate(candidate);expect(fetchMock).toHaveBeenCalledOnce();expect(console.warn).toHaveBeenCalledWith('QA public installer submission intent unavailable');
});
it('never records provenance or dispatches after a rejected manifest preflight',async()=>{
  preflight.mockRejectedValue(new Error('manifest mismatch'));server.mockReturnValue({rpc});const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  await expect(dispatchQaCandidate(candidate)).rejects.toThrow('manifest mismatch');expect(rpc).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();
});
