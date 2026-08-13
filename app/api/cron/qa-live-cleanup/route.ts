import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUCKET = 'qa-live-frames';

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: staleFrames, error: staleError } = await supabase
      .from('qa_live_frames')
      .select('candidate_id')
      .lt('updated_at', cutoff)
      .limit(25);
    if (staleError) throw new Error(`Could not load stale QA frames: ${staleError.message}`);

    let removedObjects = 0;
    const cleanedCandidateIds: string[] = [];
    for (const frame of staleFrames || []) {
      try {
        const { data: objects, error: listError } = await supabase.storage.from(BUCKET).list(frame.candidate_id, { limit: 10 });
        if (listError) throw new Error(listError.message);
        const paths = (objects || []).map((object) => `${frame.candidate_id}/${object.name}`);
        if (paths.length) {
          const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
          if (removeError) throw new Error(removeError.message);
          removedObjects += paths.length;
        }
        cleanedCandidateIds.push(frame.candidate_id);
      } catch (error) {
        console.error(`Could not clean stale QA frames for candidate ${frame.candidate_id}:`, error);
      }
    }

    if (cleanedCandidateIds.length) {
      const { error: deleteError } = await supabase.from('qa_live_frames').delete().in('candidate_id', cleanedCandidateIds);
      if (deleteError) throw new Error(`Could not remove stale QA frame metadata: ${deleteError.message}`);
    }

    return NextResponse.json({
      cleanedCandidates: cleanedCandidateIds.length,
      skippedCandidates: (staleFrames || []).length - cleanedCandidateIds.length,
      removedObjects,
    });
  } catch (error) {
    console.error('QA live-frame cleanup failed:', error);
    return NextResponse.json({ error: 'QA live-frame cleanup failed' }, { status: 500 });
  }
}
