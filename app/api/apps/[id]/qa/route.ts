import { NextRequest, NextResponse } from 'next/server';
import { getCatalogSource } from '@/lib/catalog';
import { classifyQaFailure } from '@/lib/qa/classify';
import { applyRateLimit, getIpKey, PUBLIC_RATE_LIMIT } from '@/lib/rate-limit';
import type { QaDetailsResponse } from '@/types/qa';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$/;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const rateLimitResponse = await applyRateLimit(getIpKey(request), PUBLIC_RATE_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  const { id } = await params;
  let wingetId: string;
  try {
    wingetId = decodeURIComponent(id);
  } catch {
    return NextResponse.json({ error: 'Invalid WinGet package ID' }, { status: 400 });
  }
  if (!APP_ID_PATTERN.test(wingetId)) {
    return NextResponse.json({ error: 'Invalid WinGet package ID' }, { status: 400 });
  }

  try {
    const row = await getCatalogSource().getQaResult(wingetId);
    if (!row) {
      return NextResponse.json({ error: 'No QA result is available for this app' }, { status: 404 });
    }

    const response: QaDetailsResponse = {
      wingetId: row.winget_id,
      displayName: row.display_name,
      publisher: row.publisher,
      testedVersion: row.tested_version,
      architecture: row.architecture,
      outcome: row.outcome,
      testedAtUtc: row.tested_at_utc,
      overallDurationSeconds: row.overall_duration_seconds,
      installerType: row.installer_type,
      commands: { install: row.install_command, uninstall: row.uninstall_command },
      detection: row.detection,
      phases: row.phase_results,
      changes: row.changes,
      relevantEventCount: row.relevant_event_count,
      environment: row.environment,
      testRun: { runId: row.github_run_id, runAttempt: row.github_run_attempt },
      classification:
        row.outcome === 'Failed' ? classifyQaFailure(row.phase_results, row.changes) : null,
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    console.error('Failed to load QA details:', error);
    return NextResponse.json({ error: 'Failed to load QA details' }, { status: 500 });
  }
}
