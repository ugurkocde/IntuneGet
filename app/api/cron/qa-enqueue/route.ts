import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import {
  normalizeInstallerSha256,
  normalizeQaInstallerType,
  selectWingetInstaller,
} from '@/lib/qa/candidate';
import {
  createWingetManifestClient,
  resolveWingetManifest,
} from '@/lib/winget-sync-resolution.mjs';

const BATCH_SIZE = 3;

function installerFileName(installerUrl: string, installerType: string): string {
  try {
    const decoded = decodeURIComponent(new URL(installerUrl).pathname.split('/').pop() || '');
    if (decoded && !/[\\/:*?"<>|]/.test(decoded)) return decoded;
  } catch {
    // Validation below reports the malformed URL.
  }
  return `installer.${installerType || 'exe'}`;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const [{ data: recipes, error: recipeError }, { data: policies, error: policyError }, { data: results, error: resultError }] =
    await Promise.all([
      supabase.from('qa_recipes').select('*').eq('active', true),
      supabase
        .from('app_update_policies')
        .select('winget_id')
        .eq('policy_type', 'auto_update')
        .eq('is_enabled', true),
      supabase
        .from('qa_results')
        .select('winget_id, tested_version, architecture, installer_sha256, outcome, tested_at_utc'),
    ]);
  if (recipeError) throw new Error(`Could not read QA recipes: ${recipeError.message}`);
  if (policyError) throw new Error(`Could not prioritize QA recipes: ${policyError.message}`);
  if (resultError) throw new Error(`Could not read existing QA results: ${resultError.message}`);

  const priorities = new Map<string, number>();
  for (const policy of policies || []) {
    priorities.set(policy.winget_id, (priorities.get(policy.winget_id) || 0) + 1);
  }
  const resultById = new Map((results || []).map((row) => [row.winget_id, row]));
  const client = createWingetManifestClient({ token: process.env.GITHUB_PAT, maxRetries: 2 });
  const summary = { checked: 0, queued: 0, alreadyKnown: 0, unavailable: 0, errors: [] as string[] };

  for (let index = 0; index < (recipes || []).length; index += BATCH_SIZE) {
    const batch = (recipes || []).slice(index, index + BATCH_SIZE);
    await Promise.all(
      batch.map(async (recipe) => {
        summary.checked++;
        try {
          const resolution = await resolveWingetManifest({
            client,
            wingetId: recipe.winget_id,
            storedVersion: undefined,
            preferLive: true,
          });
          if (resolution.status !== 'resolved') {
            summary.unavailable++;
            return;
          }

          const manifest = resolution.manifest as Record<string, unknown>;
          const installers = (manifest.Installers || []) as Array<Record<string, unknown>>;
          const selected = selectWingetInstaller(installers, recipe.architecture);
          const installerUrl = String(selected?.InstallerUrl || '');
          const installerSha256 = normalizeInstallerSha256(String(selected?.InstallerSha256 || ''));
          const installerType = normalizeQaInstallerType(
            String(selected?.InstallerType || manifest.InstallerType || ''),
            recipe.installer_type
          );
          if (!installerUrl.startsWith('https://') || !installerSha256) {
            throw new Error('resolved installer is missing a valid HTTPS URL or SHA-256');
          }

          const previous = resultById.get(recipe.winget_id);
          const previousMatches = Boolean(
            previous &&
              previous.tested_version === resolution.version &&
              previous.architecture.toLowerCase() === recipe.architecture.toLowerCase() &&
              previous.installer_sha256?.toUpperCase() === installerSha256
          );
          const now = new Date().toISOString();
          const initialStatus = previousMatches
            ? previous?.outcome === 'Passed'
              ? 'passed'
              : 'failed'
            : 'queued';
          const { data: inserted, error: insertError } = await supabase
            .from('qa_candidates')
            .insert({
              winget_id: recipe.winget_id,
              definition_path: recipe.definition_path,
              version: resolution.version,
              architecture: recipe.architecture,
              installer_url: installerUrl,
              installer_sha256: installerSha256,
              installer_type: installerType,
              installer_file_name: installerFileName(installerUrl, installerType),
              status: initialStatus,
              priority: priorities.get(recipe.winget_id) || 0,
              finished_at: initialStatus === 'queued' ? null : previous?.tested_at_utc || now,
              updated_at: now,
            })
            .select('id')
            .single();

          if (insertError?.code === '23505') {
            summary.alreadyKnown++;
            const { data: existing } = await supabase
              .from('qa_candidates')
              .select('id, status')
              .eq('winget_id', recipe.winget_id)
              .eq('version', resolution.version)
              .eq('architecture', recipe.architecture)
              .eq('installer_sha256', installerSha256)
              .maybeSingle();
            if (existing?.status === 'superseded') {
              await supabase
                .from('qa_candidates')
                .update({
                  status: 'queued',
                  priority: priorities.get(recipe.winget_id) || 0,
                  attempts: 0,
                  finished_at: null,
                  failure_summary: null,
                  updated_at: now,
                })
                .eq('id', existing.id)
                .eq('status', 'superseded');
              await supabase
                .from('qa_candidates')
                .update({ status: 'superseded', finished_at: now, updated_at: now })
                .eq('winget_id', recipe.winget_id)
                .eq('architecture', recipe.architecture)
                .eq('status', 'queued')
                .neq('id', existing.id);
            } else if (existing?.status === 'queued') {
              await supabase
                .from('qa_candidates')
                .update({ priority: priorities.get(recipe.winget_id) || 0, updated_at: now })
                .eq('id', existing.id)
                .eq('status', 'queued');
            }
            return;
          }
          if (insertError) throw insertError;
          if (initialStatus !== 'queued') {
            summary.alreadyKnown++;
            return;
          }

          summary.queued++;
          await supabase
            .from('qa_candidates')
            .update({ status: 'superseded', finished_at: now, updated_at: now })
            .eq('winget_id', recipe.winget_id)
            .eq('architecture', recipe.architecture)
            .eq('status', 'queued')
            .neq('id', inserted.id);
        } catch (error) {
          summary.errors.push(`${recipe.winget_id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      })
    );
  }

  return NextResponse.json(
    { success: summary.errors.length === 0, ...summary },
    { status: summary.errors.length === 0 ? 200 : 207 }
  );
}

export const maxDuration = 300;
