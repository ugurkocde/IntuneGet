import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@/types/database';
import { isCuratedPackageId } from '@/lib/curated-catalog/core.mjs';
import { evaluatePackagingContract } from '@/lib/packaging-contract';
import { enforceInstallerPreflight } from '@/lib/installer-preflight';
import { resolveWingetPackageDependencies, isWingetDependencyCompatibilityError } from '@/lib/winget-dependencies';
import { buildQaCandidatePreflightRequest } from './candidate-preflight';
import { normalizeInstallerSha256, normalizeQaInstallerType, qaInstallerFileName } from './candidate';
import { buildQaCatalogTestConfig } from './test-config';
import { buildQaDeploymentTestConfig, QA_DEPLOYMENT_TEST_PSADT_CONFIG } from './deployment-test-config';
import { normalizeQaWorkflowPackageInput, QA_PSADT_TOOLCHAIN } from './package-profile';
import { arePackageDependenciesCovered } from './dependency-reputation';
import { proveRepairProfileCorrection } from './repair-correction-lineage';

export interface RepairCorrectionRequest {
  repairId: string;
  expectedOldProfile: string;
  expectedNewProfile: string;
  contract: 'exe-embedded-msi-target@1779';
}
type ManifestClient = {fetchInstallerManifest: (id: string, version: string) => Promise<Record<string, unknown> | null>};
type Result = {outcome: 'adopted'; candidateId: string} | {outcome: 'denied'; reason: string};
const denied = (reason: string): Result => ({outcome: 'denied', reason});

/** Explicit operator request only. Execution inputs are never accepted here. */
export function parseRepairCorrectionRequest(value: unknown): RepairCorrectionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid correction request');
  const body=value as Record<string, unknown>;
  if (Object.keys(body).length !== 4 || Object.keys(body).some(k=>!['repairId','expectedOldProfile','expectedNewProfile','contract'].includes(k)) ||
    typeof body.repairId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.repairId) ||
    typeof body.expectedOldProfile !== 'string' || !/^[A-F0-9]{64}$/.test(body.expectedOldProfile) ||
    typeof body.expectedNewProfile !== 'string' || !/^[A-F0-9]{64}$/.test(body.expectedNewProfile) ||
    body.contract !== 'exe-embedded-msi-target@1779') throw new Error('Invalid correction request');
  return body as unknown as RepairCorrectionRequest;
}

/**
 * Prepare an inert corrected profile through a single guarded transaction.
 * A separate existing retest grant is still required to enter the fair queue.
 */
export async function adoptRepairCorrectedCandidate(
  supabase: SupabaseClient, client: ManifestClient, request: RepairCorrectionRequest,
): Promise<Result> {
  const rr=await supabase.from('qa_repair_requests').select('id,candidate_id,winget_id,version,architecture,status,failure_class,prior_requeues').eq('id',request.repairId).maybeSingle();
  if(rr.error)throw new Error('Could not read repair');
  const repair=rr.data;
  const audit=await supabase.from('qa_repair_profile_corrections').select('old_profile,new_profile,new_candidate_id,contract').eq('repair_id',request.repairId).maybeSingle();
  if(audit.error)throw new Error('Could not read correction lineage');
  if(audit.data){
    if(!repair || audit.data.old_profile!==request.expectedOldProfile || audit.data.new_profile!==request.expectedNewProfile ||
      audit.data.contract!==request.contract || repair.candidate_id!==audit.data.new_candidate_id)return denied('correction_lineage_conflict');
    return {outcome:'adopted',candidateId:audit.data.new_candidate_id};
  }
  if(!repair || !['pending','in_progress'].includes(repair.status) || repair.failure_class!=='app_lifecycle' ||
    repair.prior_requeues==null || repair.prior_requeues>=3 || isCuratedPackageId(repair.winget_id))return denied('repair_ineligible');
  const cr=await supabase.from('qa_candidates').select('id,winget_id,version,architecture,installer_sha256,installer_url,test_config,package_profile_sha256').eq('id',repair.candidate_id).maybeSingle();
  if(cr.error)throw new Error('Could not read original candidate');
  const old=cr.data;
  if(!old || old.winget_id.toLowerCase()!==repair.winget_id.toLowerCase() || old.version!==repair.version || old.architecture!==repair.architecture ||
    !['x64','x86'].includes(old.architecture) || old.package_profile_sha256!==request.expectedOldProfile)return denied('repair_tuple_or_cas_changed');
  const hash=normalizeInstallerSha256(old.installer_sha256);
  if(!hash || !old.installer_url?.startsWith('https://'))return denied('installer_metadata_missing');
  const manifest=await client.fetchInstallerManifest(repair.winget_id,repair.version);
  if(!manifest || manifest.PackageIdentifier!==repair.winget_id || manifest.PackageVersion!==repair.version)return denied('manifest_identity_mismatch');
  const matches=(Array.isArray(manifest.Installers)?manifest.Installers:[]).filter((i:Record<string, unknown>)=>
    typeof i.Architecture==='string' && i.Architecture.toLowerCase()===old.architecture &&
    normalizeInstallerSha256(typeof i.InstallerSha256==='string'?i.InstallerSha256:null)===hash && i.InstallerUrl===old.installer_url);
  if(matches.length!==1)return denied('installer_missing_or_ambiguous');
  const [ar,pr]=await Promise.all([
    supabase.from('curated_apps').select('winget_id,name,publisher').eq('winget_id',repair.winget_id).eq('is_verified',true).eq('is_winget_verified',true).eq('app_source','win32').eq('is_locale_variant',false).maybeSingle(),
    supabase.from('qa_recipes').select('definition_path,architecture').eq('winget_id',repair.winget_id).eq('active',true).maybeSingle(),
  ]);
  if(ar.error||pr.error)throw new Error('Could not read catalog configuration');
  if(!ar.data || (pr.data && pr.data.architecture!==old.architecture))return denied('catalog_ineligible');
  const trusted=buildQaCatalogTestConfig({app:{...ar.data,wingetId:repair.winget_id,version:repair.version},manifest,installer:matches[0]});
  if(!evaluatePackagingContract({wingetId:repair.winget_id,installerType:trusted.sourceInstallerType,silentArgs:trusted.silentArgs,nestedInstallerType:trusted.nestedInstallerType,nestedInstallerFiles:trusted.nestedInstallerFiles}).valid)return denied('packaging_contract_invalid');
  let dependencies;
  try{dependencies=await resolveWingetPackageDependencies({wingetId:repair.winget_id,version:repair.version,architecture:old.architecture,installerSha256:hash,installScope:trusted.scope});}
  catch(error){if(isWingetDependencyCompatibilityError(error))return denied('dependency_incompatible');throw new Error('Could not resolve package dependencies');}
  const normalized=normalizeQaWorkflowPackageInput({wingetId:repair.winget_id,displayName:ar.data.name,publisher:ar.data.publisher,version:repair.version,architecture:old.architecture,installerSha256:hash,installerType:trusted.sourceInstallerType,silentSwitches:trusted.silentArgs,installerSuccessCodes:trusted.successCodes,uninstallCommand:trusted.uninstallCommand,installScope:trusted.scope,nestedInstallerType:trusted.nestedInstallerType,nestedInstallerPath:trusted.nestedInstallerFiles[0]??'',psadtConfig:JSON.stringify(QA_DEPLOYMENT_TEST_PSADT_CONFIG),detectionRules:'[]',packageDependencies:dependencies});
  const config=buildQaDeploymentTestConfig(normalized,dependencies);
  const tuple={candidateWingetId:old.winget_id,candidateVersion:old.version,candidateArchitecture:old.architecture,candidateInstallerSha256:hash};
  const proof=proveRepairProfileCorrection({...request,requiredPackagerCommit:QA_PSADT_TOOLCHAIN.packagerCommit,
    old:{...tuple,testConfig:old.test_config,candidatePackageProfileSha256:old.package_profile_sha256},
    current:{...tuple,testConfig:config,candidatePackageProfileSha256:normalized.identity.packageProfileSha256}});
  if(!proof.valid)return denied(proof.reason);
  // Reuse the current covered, clean reputation contract for primary and all
  // dependencies. This never scans, releases a hold or widens admission.
  if(!await arePackageDependenciesCovered(supabase,[{installerSha256:hash},...dependencies]))return denied('security_or_dependency_coverage_missing');
  const candidate={winget_id:repair.winget_id,definition_path:pr.data?.definition_path??null,version:repair.version,architecture:old.architecture,
    installer_url:old.installer_url,installer_sha256:hash,installer_type:normalizeQaInstallerType(trusted.sourceInstallerType),installer_file_name:qaInstallerFileName(old.installer_url,trusted.sourceInstallerType),
    test_level:'psadt-package',package_profile_sha256:proof.newProfile,test_config:config as unknown as Json,catalog_version_at_enqueue:repair.version};
  // This runs only on the server. The VM dispatch repeats its normal exact
  // payload preflight; preparing a profile neither dispatches nor replays work.
  await enforceInstallerPreflight(buildQaCandidatePreflightRequest(candidate));
  const adopted=await supabase.rpc('adopt_qa_repair_corrected_candidate',{p_repair_id:request.repairId,p_candidate:candidate,
    p_expected_old_profile:proof.oldProfile,p_expected_new_profile:proof.newProfile,p_contract:request.contract});
  if(adopted.error)return denied('adoption_guard_rejected');
  if(typeof adopted.data!=='string'||!/^[0-9a-f-]{36}$/i.test(adopted.data))throw new Error('Invalid adoption result');
  return {outcome:'adopted',candidateId:adopted.data};
}
