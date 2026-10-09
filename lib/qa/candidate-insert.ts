import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';

type Candidate = Database['public']['Tables']['qa_candidates']['Row'];
type InsertOutcome = { outcome: 'inserted' | 'exact_conflict' | 'active_conflict'; candidate: Candidate };

/** Insert only; existing candidates remain owned by the guarded reuse paths. */
export async function insertQaCandidate(
  supabase: SupabaseClient,
  row: Database['public']['Tables']['qa_candidates']['Insert'],
) {
  const { data, error } = await supabase.rpc('insert_qa_candidate_if_absent', { p_candidate: row as Json });
  if (error) return { data: null, existing: null, outcome: null, error };
  const result = data as InsertOutcome | null;
  if (!result?.candidate?.id || !['inserted', 'exact_conflict', 'active_conflict'].includes(result.outcome)) {
    throw new Error('QA candidate insert returned an invalid outcome');
  }
  return {
    data: result.outcome === 'inserted' ? result.candidate : null,
    existing: result.outcome === 'inserted' ? null : result.candidate,
    outcome: result.outcome,
    error: null,
  };
}
