const GITHUB_STATUS_COMPONENTS_URL =
  'https://www.githubstatus.com/api/v2/components.json';
const GITHUB_STATUS_TIMEOUT_MS = 5_000;

export interface GitHubActionsHealth {
  operational: boolean;
  status: string;
}

interface StatusPageComponent {
  name?: unknown;
  status?: unknown;
}

export async function getGitHubActionsHealth(
  fetchImpl: typeof fetch = fetch
): Promise<GitHubActionsHealth> {
  try {
    const response = await fetchImpl(GITHUB_STATUS_COMPONENTS_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(GITHUB_STATUS_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { operational: false, status: 'unknown' };
    }

    const payload = await response.json() as { components?: unknown };
    if (!Array.isArray(payload.components)) {
      return { operational: false, status: 'unknown' };
    }

    const actions = (payload.components as StatusPageComponent[]).find(
      (component) => component.name === 'Actions'
    );
    if (typeof actions?.status !== 'string') {
      return { operational: false, status: 'unknown' };
    }

    return {
      operational: actions.status === 'operational',
      status: actions.status,
    };
  } catch {
    // QA can safely wait for the next cron tick. Failing closed prevents an
    // unavailable status endpoint from consuming app attempts as false
    // workflow-dispatch timeouts.
    return { operational: false, status: 'unknown' };
  }
}
