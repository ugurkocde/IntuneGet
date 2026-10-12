import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@/types/database';
import { isCuratedPackageId } from '@/lib/curated-catalog/core.mjs';
import { normalizeInstallerSha256, normalizeQaInstallerType, qaInstallerFileName } from './candidate';
import { insertQaCandidate } from './candidate-insert';
import { AWAITING_DIAGNOSTIC_RETEST_GRANT } from './candidate-reactivation';
import { buildQaCatalogTestConfig } from './test-config';
import { buildQaPackageIdentity } from './package-profile';
import { evaluatePackagingContract } from '@/lib/packaging-contract';
import { isWingetDependencyCompatibilityError, resolveWingetPackageDependencies } from '@/lib/winget-dependencies';

type ManifestClient = { fetchInstallerManifest: (id: string, version: string) => Promise<Record<string, unknown> | null> };
type AdoptionResult = { outcome: 'adopted' | 'denied'; candidateId?: string; reason?: string };
const denied = (reason: string): AdoptionResult => ({ outcome: 'denied', reason });

export function repairIdFromRequest(request: Request): string | null {
  const params = new URL(request.url).searchParams;
  if (!params.has('repair')) return null;
  const values = params.getAll('repair');
  if (values.length !== 1 || params.has('id') || params.has('ids') ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values[0])) {
    throw new Error('Provide one repair UUID without id or ids');
  }
  return values[0];
}

/** Prepare one exact historical payload. Only the locked RPC may rebind it. */
export async function adoptRepairCurrentCandidate(
  supabase: SupabaseClient, client: ManifestClient, repairId: string,
): Promise<AdoptionResult> {
  const repairResult = await supabase.from('qa_repair_requests')
    .select('id,candidate_id,winget_id,version,architecture,status,failure_class,prior_requeues')
    .eq('id', repairId).maybeSingle();
  if (repairResult.error) throw new Error('Could not read repair');
  const repair = repairResult.data;
  if (!repair || !['pending','in_progress'].includes(repair.status) || repair.failure_class !== 'app_lifecycle' ||
    repair.prior_requeues == null || repair.prior_requeues >= 3 || isCuratedPackageId(repair.winget_id)) return denied('repair_ineligible');
  const oldResult = await supabase.from('qa_candidates')
    .select('id,winget_id,version,architecture,installer_sha256,installer_url,test_config')
    .eq('id', repair.candidate_id).maybeSingle();
  if (oldResult.error) throw new Error('Could not read original candidate');
  const old = oldResult.data;
  if (!old || old.winget_id.toLowerCase() !== repair.winget_id.toLowerCase() || old.version !== repair.version ||
    old.architecture !== repair.architecture || !['x64','x86'].includes(old.architecture)) return denied('repair_tuple_changed');
  const hash = normalizeInstallerSha256(old.installer_sha256);
  if (!hash || !old.installer_url?.startsWith('https://')) return denied('installer_metadata_missing');
  const manifest = await client.fetchInstallerManifest(repair.winget_id, repair.version);
  if (!manifest) return denied('version_missing');
  if (manifest.PackageIdentifier !== repair.winget_id || manifest.PackageVersion !== repair.version) return denied('manifest_identity_mismatch');
  const matches = (Array.isArray(manifest.Installers) ? manifest.Installers : []).filter((entry: Record<string, unknown>) =>
    typeof entry.Architecture === 'string' && entry.Architecture.toLowerCase() === old.architecture.toLowerCase() &&
    normalizeInstallerSha256(typeof entry.InstallerSha256 === 'string' ? entry.InstallerSha256 : null) === hash &&
    entry.InstallerUrl === old.installer_url);
  if (!matches.length) return denied('installer_hash_changed');
  if (matches.length !== 1) return denied('installer_ambiguous');
  const [appResult, recipeResult] = await Promise.all([
    supabase.from('curated_apps').select('winget_id,name,publisher,latest_version').eq('winget_id', repair.winget_id)
      .eq('is_verified', true).eq('is_winget_verified', true).eq('app_source','win32').eq('is_locale_variant',false).maybeSingle(),
    supabase.from('qa_recipes').select('definition_path,architecture').eq('winget_id',repair.winget_id).eq('active',true).maybeSingle(),
  ]);
  if (appResult.error || recipeResult.error) throw new Error('Could not read exact catalog configuration');
  if (!appResult.data) return denied('catalog_ineligible');
  if (recipeResult.data && recipeResult.data.architecture !== old.architecture) return denied('recipe_architecture_changed');
  const config = buildQaCatalogTestConfig({ app:{...appResult.data,wingetId:repair.winget_id,version:repair.version},manifest,installer:matches[0] });
  if (config.scope !== old.test_config?.scope || config.profileKind !== 'catalog-default') return denied('scope_changed');
  let dependencies;
  try {
    dependencies = await resolveWingetPackageDependencies({wingetId:repair.winget_id,version:repair.version,architecture:old.architecture,installerSha256:hash,installScope:config.scope});
  } catch (error) {
    if (isWingetDependencyCompatibilityError(error)) return denied('dependency_incompatible');
    throw new Error('Could not resolve exact package dependencies');
  }
  if (dependencies.length) config.packageDependencies = dependencies;
  if (!evaluatePackagingContract({wingetId:repair.winget_id,installerType:config.sourceInstallerType,silentArgs:config.silentArgs,nestedInstallerType:config.nestedInstallerType,nestedInstallerFiles:config.nestedInstallerFiles}).valid) return denied('packaging_contract_invalid');
  const identity = buildQaPackageIdentity({profileKind:config.profileKind,wingetId:repair.winget_id,displayName:config.displayName,publisher:config.publisher,version:repair.version,architecture:old.architecture,installerSha256:hash,sourceInstallerType:config.sourceInstallerType,silentArgs:config.silentArgs,successCodes:config.successCodes,uninstallCommand:config.uninstallCommand,installScope:config.scope,nestedInstallerType:config.nestedInstallerType,nestedInstallerFiles:config.nestedInstallerFiles,psadtConfig:config.psadtConfig,detectionRules:config.detectionRules,packageDependencies:dependencies});
  Object.assign(config,{packageProfileCanonicalJson:identity.canonicalJson,packageProfileSha256:identity.packageProfileSha256,psadtConfigSha256:identity.psadtConfigSha256,detectionRulesSha256:identity.detectionRulesSha256});
  const now = new Date().toISOString();
  const inserted = await insertQaCandidate(supabase,{winget_id:repair.winget_id,definition_path:recipeResult.data?.definition_path??null,version:repair.version,architecture:old.architecture,installer_url:old.installer_url,installer_sha256:hash,installer_type:normalizeQaInstallerType(config.sourceInstallerType),installer_file_name:qaInstallerFileName(old.installer_url,config.sourceInstallerType),test_level:'psadt-package',package_profile_sha256:identity.packageProfileSha256,test_config:config as unknown as Json,catalog_version_at_enqueue:repair.version,status:'superseded',priority:10,demand_source:'operator',failure_summary:AWAITING_DIAGNOSTIC_RETEST_GRANT,finished_at:now,updated_at:now});
  if (inserted.error) throw new Error('Could not prepare diagnostic candidate');
  if (inserted.outcome === 'active_conflict') return denied('active_conflict');
  const candidate = inserted.data ?? inserted.existing;
  if (!candidate || candidate.status !== 'superseded' || candidate.failure_summary !== AWAITING_DIAGNOSTIC_RETEST_GRANT) return denied('exact_profile_exists');
  // The RPC also validates foreign attachments on an exact insert conflict.
  const adopted = await supabase.rpc('adopt_qa_repair_current_candidate',{p_repair_id:repairId,p_candidate_id:candidate.id});
  if (adopted.error) return denied('adoption_guard_rejected');
  if (adopted.data !== candidate.id) throw new Error('Invalid adoption result');
  return {outcome:'adopted',candidateId:candidate.id};
}
