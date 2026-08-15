import { NextRequest, NextResponse } from 'next/server';
import { getCatalogSource } from '@/lib/catalog';
import { classifyQaFailure } from '@/lib/qa/classify';
import { applyRateLimit, getIpKey, QA_DETAILS_RATE_LIMIT } from '@/lib/rate-limit';
import type { QaDetailsResponse } from '@/types/qa';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const PACKAGE_PROFILE_PATTERN = /^[A-Fa-f0-9]{64}$/;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const rateLimitResponse = await applyRateLimit(
    `qa-details:${getIpKey(request)}`,
    QA_DETAILS_RATE_LIMIT
  );
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
  const requestedProfile = request.nextUrl.searchParams.get('profile');
  if (requestedProfile && !PACKAGE_PROFILE_PATTERN.test(requestedProfile)) {
    return NextResponse.json({ error: 'Invalid QA package profile' }, { status: 400 });
  }
  const packageProfileSha256 = requestedProfile?.toUpperCase();

  try {
    const row = await getCatalogSource().getQaResult(wingetId, packageProfileSha256);
    if (!row) {
      return NextResponse.json(
        {
          error: packageProfileSha256
            ? 'This exact QA result is still being published'
            : 'No QA result is available for this app',
        },
        { status: 404, headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' } }
      );
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
      effectiveConfiguration: row.effective_configuration,
      virusTotal: row.virustotal_status
        ? {
            status: row.virustotal_status,
            malicious: row.virustotal_malicious ?? null,
            suspicious: row.virustotal_suspicious ?? null,
            totalEngines: row.virustotal_total_engines ?? null,
            scannedAtUtc: row.virustotal_scanned_at_utc ?? null,
          }
        : null,
      package: {
        testLevel: row.test_level,
        profileSha256: row.package_profile_sha256,
        psadtVersion: row.psadt_version,
        psadtTemplateSha256: row.psadt_template_sha256,
        psadtConfigSha256: row.psadt_config_sha256,
        detectionRulesSha256: row.detection_rules_sha256,
        packagerCommit: row.packager_commit,
        contentSha256: row.package_content_sha256,
      },
      classification:
        row.outcome === 'Failed' ? classifyQaFailure(row.phase_results, row.changes) : null,
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    console.error('Failed to load QA details:', error);
    return NextResponse.json(
      { error: 'QA evidence is temporarily unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' } }
    );
  }
}
