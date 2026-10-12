import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

export function subscribeLandingCounters(
  update: (id: string, value: number) => void,
  connectionChanged: (connected: boolean) => void,
): () => void {
  if (!isSupabaseConfigured()) return () => {};
  const supabase = getSupabaseClient();
  const channel = supabase.channel(`site_counters_${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'site_counters' }, payload => {
      if (payload.eventType === 'DELETE') return;
      const { id, value } = payload.new as { id: string; value: unknown };
      const numeric = Number(value);
      if (Number.isFinite(numeric)) update(id, numeric);
    })
    .subscribe(status => connectionChanged(status === 'SUBSCRIBED'));
  return () => { connectionChanged(false); void supabase.removeChannel(channel); };
}
