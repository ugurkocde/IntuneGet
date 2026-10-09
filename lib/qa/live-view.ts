import type { QaLiveResponse } from '@/types/qa';

export function selectQaLiveCard(data: QaLiveResponse): 'ordinary' | 'curated' | 'catalogBusy' | 'next' | 'idle' {
  if (data.current) return data.current.runKind === 'curated' ? 'curated' : 'ordinary';
  if (data.vmBusy === 'catalog_verification') return 'catalogBusy';
  return data.queue.next.length ? 'next' : 'idle';
}

export function qaLiveFrameSrc(data: QaLiveResponse): string | null {
  if (!data.current || !data.viewer.available || data.viewer.sequence === null || !Number.isSafeInteger(data.viewer.sequence)) return null;
  if (data.current.runKind === 'curated') {
    return data.current.verification === 'release' && data.viewer.sessionId
      ? `/api/qa/live/session/frame?session=${encodeURIComponent(data.viewer.sessionId)}&sequence=${data.viewer.sequence}` : null;
  }
  return data.viewer.candidateId
    ? `/api/qa/live/frame?candidate=${encodeURIComponent(data.viewer.candidateId)}&sequence=${data.viewer.sequence}` : null;
}

export function qaLiveViewerKey(data: QaLiveResponse): string {
  return data.current?.runKind === 'curated'
    ? `curated-${data.viewer.sessionId ?? 'no-session'}-${data.current.startedAt}`
    : `ordinary-${data.viewer.candidateId ?? data.current?.wingetId ?? 'idle'}-${data.current?.startedAt ?? ''}`;
}

export function qaLiveRefetchInterval(data: QaLiveResponse | undefined): number {
  const phase = data?.current?.phase;
  if (phase === 'installing' || phase === 'uninstalling' || phase === 'installing_previous' || phase === 'upgrading') return 1_000;
  return data?.active ? 2_000 : 10_000;
}
