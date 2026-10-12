import { withDatabaseRetry } from './release-note-db-retry.mjs';
import { createClient } from '@supabase/supabase-js';
import { createWingetManifestClient, manifestReleaseNotesUrl } from '../lib/winget-sync-resolution.mjs';

const limit = Number(process.env.MAX_VERSIONS || 200);
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('MAX_VERSIONS must be 1-1000');
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials are required');
const db = createClient(url, key, { auth: { persistSession: false } });
const manifests = createWingetManifestClient({ token: process.env.GITHUB_TOKEN, preferRaw: true, maxRetries: 2 });
const { data } = await withDatabaseRetry(() => db.from('version_history').select('id,winget_id,version')
  .is('release_notes_url_checked_at', null).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
  .abortSignal(AbortSignal.timeout(15_000)));
let checked = 0, linked = 0, failed = 0;
const queue = [...data];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let row; (row = queue.shift());) {
    try {
      const manifest = await manifests.fetchLocaleManifest(row.winget_id, row.version);
      const release_notes_url = manifestReleaseNotesUrl(manifest);
      await withDatabaseRetry(() => db.from('version_history').update({
        release_notes_url, release_notes_url_checked_at: new Date().toISOString(),
      }).eq('id', row.id).abortSignal(AbortSignal.timeout(15_000)));
      checked++; if (release_notes_url) linked++;
    } catch (error) {
      failed++;
      console.error(`${row.winget_id} ${row.version}: ${error.message}`);
    }
  }
}));
console.log(JSON.stringify({ checked, linked, failed }));
if (failed) process.exitCode = 1;
