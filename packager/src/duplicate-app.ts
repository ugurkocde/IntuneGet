/** IntuneGet marker included in managed app descriptions. */
export const INTUNE_APP_SOURCE_MARKER = 'Source: IntuneGet.com';

export interface DuplicateAppInfo {
  matchType: 'exact';
  existingAppId: string;
  existingAppUrl: string;
  existingVersion?: string;
  createdAt?: string;
}

interface DuplicateLookupJob {
  display_name: string;
  winget_id: string;
}

interface GraphReader {
  get<T>(path: string): Promise<T>;
}

interface GraphMobileAppSummary {
  id: string;
  displayName?: string;
  description?: string | null;
}

interface GraphWin32AppDetails extends GraphMobileAppSummary {
  '@odata.type'?: string;
  displayVersion?: string | null;
  createdDateTime?: string;
  publishingState?: string | null;
  committedContentVersion?: string | null;
}

interface GraphAppPage {
  value?: GraphMobileAppSummary[];
  '@odata.nextLink'?: string;
}

function isIntuneGetFingerprint(description: string | null | undefined, wingetId: string): boolean {
  if (!description) return false;
  const wingetMarker = description.match(/Winget:\s*(\S+)/);
  if (wingetMarker) {
    return Boolean(wingetId) && wingetMarker[1].toLowerCase() === wingetId.toLowerCase();
  }
  return description.includes(INTUNE_APP_SOURCE_MARKER);
}

function graphPathFromNextLink(nextLink: string): string {
  return nextLink.replace(/^https:\/\/graph\.microsoft\.com\/(?:beta|v1\.0)/, '');
}

/**
 * Find a committed, published IntuneGet Win32 app with the same display name
 * and source fingerprint. The collection query selects only base mobileApp
 * fields; Win32-only fields are read from an individual polymorphic resource.
 */
export async function findDuplicateIntuneApp(
  graphClient: GraphReader,
  job: DuplicateLookupJob,
): Promise<DuplicateAppInfo | null> {
  const displayNameLower = job.display_name.toLowerCase();
  let nextPath: string | null =
    `/deviceAppManagement/mobileApps?$filter=isof('microsoft.graph.win32LobApp')` +
    `&$select=id,displayName,description`;

  while (nextPath) {
    const page: GraphAppPage = await graphClient.get<GraphAppPage>(nextPath);
    for (const app of page.value ?? []) {
      if (
        app.displayName?.toLowerCase() !== displayNameLower ||
        !isIntuneGetFingerprint(app.description, job.winget_id)
      ) {
        continue;
      }

      // Graph validates collection $select against mobileApp, so fetch the
      // polymorphic resource before reading Win32-only properties.
      const details = await graphClient.get<GraphWin32AppDetails>(
        `/deviceAppManagement/mobileApps/${encodeURIComponent(app.id)}`,
      );
      if (
        details.publishingState?.toLowerCase() !== 'published' ||
        !details.committedContentVersion?.trim()
      ) {
        continue;
      }

      const appId = details.id || app.id;
      return {
        matchType: 'exact',
        existingAppId: appId,
        existingAppUrl: `https://intune.microsoft.com/#view/Microsoft_Intune_Apps/SettingsMenu/~/0/appId/${appId}`,
        existingVersion: details.displayVersion ?? undefined,
        createdAt: details.createdDateTime,
      };
    }

    nextPath = page['@odata.nextLink']
      ? graphPathFromNextLink(page['@odata.nextLink'])
      : null;
  }

  return null;
}
