// Each write guards its own conflict or current row state. A preceding read
// must never authorize replacing completed installation evidence.
export async function writeSnapshot(supabase, record) {
  if (!record.winget_id || !record.version || !['completed', 'failed', 'skipped'].includes(record.scan_status)) {
    throw new Error('Invalid installation snapshot identity or status');
  }

  if (record.scan_status === 'completed') {
    const { data, error } = await supabase.from('installation_snapshots')
      .upsert(record, { onConflict: 'winget_id,version' }).select('id');
    if (error) throw error;
    if (data?.length !== 1) throw new Error('Completed snapshot was not persisted');
    return 'uploaded';
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: updated, error: updateError } = await supabase.from('installation_snapshots')
      .update(record).eq('winget_id', record.winget_id).eq('version', record.version)
      .or('scan_status.is.null,scan_status.neq.completed').select('id');
    if (updateError) throw updateError;
    if (updated?.length === 1) return 'uploaded';

    const { data: inserted, error: insertError } = await supabase.from('installation_snapshots')
      .upsert(record, { onConflict: 'winget_id,version', ignoreDuplicates: true }).select('id');
    if (insertError) throw insertError;
    if (inserted?.length === 1) return 'uploaded';

    // This read classifies a no-op only. Any retry still uses guarded writes.
    // Do not report preserved success for an absent or otherwise hidden row.
    const { data: existing, error: readError } = await supabase.from('installation_snapshots')
      .select('id,scan_status').eq('winget_id', record.winget_id).eq('version', record.version).maybeSingle();
    if (readError) throw readError;
    if (existing?.scan_status === 'completed') return 'preserved';
  }
  throw new Error('Installation snapshot reconciliation did not converge');
}
