const GITHUB_API_BASE = 'https://api.github.com/repos/microsoft/winget-pkgs';
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$/;

interface GitHubCommitSummary {
  sha?: string;
  parents?: Array<{ sha?: string }>;
}

interface GitHubChangedFile {
  filename?: string;
  status?: string;
}

interface GitHubComparison {
  status?: string;
  total_commits?: number;
  files?: GitHubChangedFile[];
}

export interface WingetChangeSet {
  baseSha: string | null;
  headSha: string;
  changedFiles: number;
  changedPackageIds: string[];
  initialized: boolean;
  etag: string | null;
  rateLimitedUntil: string | null;
}

export interface DetectWingetChangesOptions {
  token?: string;
  baseSha?: string | null;
  since?: string;
  etag?: string | null;
  rateLimitedUntil?: string | null;
  fetchImpl?: typeof fetch;
}

class GitHubRateLimitError extends Error {
  constructor(public readonly resetAt: string | null) {
    super(`WinGet GitHub change feed is rate limited${resetAt ? ` until ${resetAt}` : ''}`);
    this.name = 'GitHubRateLimitError';
  }
}

function githubHeaders(token?: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'IntuneGet-QA-Poller',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubJson<T>(
  fetchImpl: typeof fetch,
  path: string,
  token?: string,
  ifNoneMatch?: string | null
): Promise<{ data: T | null; etag: string | null; notModified: boolean }> {
  const headers = new Headers(githubHeaders(token));
  if (ifNoneMatch) headers.set('If-None-Match', ifNoneMatch);
  const response = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
    headers,
    cache: 'no-store',
  });
  if (response.status === 304) {
    return { data: null, etag: response.headers.get('etag') || ifNoneMatch || null, notModified: true };
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    const rateLimited =
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get('x-ratelimit-remaining') === '0' ||
          /rate limit exceeded/i.test(detail)));

    if (rateLimited) {
      const resetEpoch = Number(response.headers.get('x-ratelimit-reset'));
      const resetAt =
        Number.isFinite(resetEpoch) && resetEpoch > 0
          ? new Date(resetEpoch * 1000).toISOString()
          : null;
      throw new GitHubRateLimitError(resetAt);
    }

    const resetEpoch = Number(response.headers.get('x-ratelimit-reset'));
    const reset =
      Number.isFinite(resetEpoch) && resetEpoch > 0
        ? `; resets ${new Date(resetEpoch * 1000).toISOString()}`
        : '';
    throw new Error(`WinGet change feed failed (${response.status}${reset}): ${detail || path}`);
  }
  return {
    data: (await response.json()) as T,
    etag: response.headers.get('etag'),
    notModified: false,
  };
}

export function wingetIdFromManifestPath(path: string): string | null {
  if (!path.toLowerCase().startsWith('manifests/')) return null;
  const fileName = path.split('/').pop() || '';
  if (!/\.ya?ml$/i.test(fileName) || /\.locale\.[^.]+\.ya?ml$/i.test(fileName)) {
    return null;
  }

  const id = fileName
    .replace(/\.installer\.ya?ml$/i, '')
    .replace(/\.ya?ml$/i, '');
  return APP_ID_PATTERN.test(id) ? id : null;
}

function changedPackageIds(files: GitHubChangedFile[]): string[] {
  const ids = new Set<string>();
  for (const file of files) {
    if (!file.filename || file.status === 'removed') continue;
    const id = wingetIdFromManifestPath(file.filename);
    if (id) ids.add(id);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

async function compare(
  fetchImpl: typeof fetch,
  baseSha: string,
  headSha: string,
  token?: string
): Promise<{ changedFiles: number; changedPackageIds: string[] }> {
  if (baseSha === headSha) return { changedFiles: 0, changedPackageIds: [] };
  const response = await githubJson<GitHubComparison>(
    fetchImpl,
    `/compare/${baseSha}...${headSha}`,
    token
  );
  const result = response.data!;
  if (result.status === 'diverged' || result.status === 'behind') {
    throw new Error(`WinGet change cursor is not an ancestor of ${headSha}`);
  }
  const files = result.files || [];
  if ((result.total_commits || 0) >= 250 || files.length >= 300) {
    throw new Error('WinGet change window exceeded GitHub compare limits; cursor was not advanced');
  }
  return { changedFiles: files.length, changedPackageIds: changedPackageIds(files) };
}

export async function detectWingetChanges({
  token,
  baseSha,
  since = new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  etag,
  rateLimitedUntil,
  fetchImpl = fetch,
}: DetectWingetChangesOptions = {}): Promise<WingetChangeSet> {
  const deferredUntilMs = rateLimitedUntil ? Date.parse(rateLimitedUntil) : Number.NaN;
  if (baseSha && Number.isFinite(deferredUntilMs) && deferredUntilMs > Date.now()) {
    return {
      baseSha,
      headSha: baseSha,
      changedFiles: 0,
      changedPackageIds: [],
      initialized: false,
      etag: etag || null,
      rateLimitedUntil: new Date(deferredUntilMs).toISOString(),
    };
  }

  let latestResponse: Awaited<ReturnType<typeof githubJson<GitHubCommitSummary[]>>>;
  try {
    latestResponse = await githubJson<GitHubCommitSummary[]>(
      fetchImpl,
      '/commits?per_page=1',
      token,
      baseSha ? etag : null
    );
  } catch (error) {
    if (error instanceof GitHubRateLimitError && baseSha) {
      console.warn(JSON.stringify({
        level: 'warning',
        message: 'qa_winget_github_authenticated_rate_limit',
        route: '/api/cron/qa-enqueue',
        resetAt: error.resetAt,
      }));
      return {
        baseSha,
        headSha: baseSha,
        changedFiles: 0,
        changedPackageIds: [],
        initialized: false,
        etag: etag || null,
        rateLimitedUntil: error.resetAt || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      };
    }
    throw error;
  }
  if (latestResponse.notModified) {
    if (!baseSha) throw new Error('WinGet change feed returned 304 without a stored cursor');
    return {
      baseSha,
      headSha: baseSha,
      changedFiles: 0,
      changedPackageIds: [],
      initialized: false,
      etag: latestResponse.etag || etag || null,
      rateLimitedUntil: null,
    };
  }
  const latest = latestResponse.data!;
  const headSha = latest[0]?.sha?.toLowerCase() || '';
  if (!SHA_PATTERN.test(headSha)) throw new Error('WinGet change feed returned an invalid head SHA');

  if (baseSha) {
    const normalizedBase = baseSha.toLowerCase();
    if (!SHA_PATTERN.test(normalizedBase)) throw new Error('Stored WinGet cursor SHA is invalid');
    const changes = await compare(fetchImpl, normalizedBase, headSha, token);
    return {
      baseSha: normalizedBase,
      headSha,
      ...changes,
      initialized: false,
      etag: latestResponse.etag || null,
      rateLimitedUntil: null,
    };
  }

  const recentResponse = await githubJson<GitHubCommitSummary[]>(
    fetchImpl,
    `/commits?per_page=100&since=${encodeURIComponent(since)}`,
    token
  );
  const recent = recentResponse.data!;
  if (recent.length === 0) {
    return {
      baseSha: null,
      headSha,
      changedFiles: 0,
      changedPackageIds: [],
      initialized: true,
      etag: latestResponse.etag || null,
      rateLimitedUntil: null,
    };
  }
  if (recent.length >= 100) {
    throw new Error('Initial WinGet lookback exceeded 100 commits; cursor was not initialized');
  }
  const oldestParent = recent[recent.length - 1]?.parents?.[0]?.sha?.toLowerCase() || '';
  if (!SHA_PATTERN.test(oldestParent)) {
    throw new Error('Initial WinGet change feed did not include a valid parent SHA');
  }
  const changes = await compare(fetchImpl, oldestParent, headSha, token);
  return {
    baseSha: oldestParent,
    headSha,
    ...changes,
    initialized: true,
    etag: latestResponse.etag || null,
    rateLimitedUntil: null,
  };
}
