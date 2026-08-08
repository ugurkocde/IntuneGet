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
}

export interface DetectWingetChangesOptions {
  token?: string;
  baseSha?: string | null;
  since?: string;
  fetchImpl?: typeof fetch;
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
  token?: string
): Promise<T> {
  const response = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
    headers: githubHeaders(token),
    cache: 'no-store',
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`WinGet change feed failed (${response.status}): ${detail || path}`);
  }
  return (await response.json()) as T;
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
  const result = await githubJson<GitHubComparison>(
    fetchImpl,
    `/compare/${baseSha}...${headSha}`,
    token
  );
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
  fetchImpl = fetch,
}: DetectWingetChangesOptions = {}): Promise<WingetChangeSet> {
  const latest = await githubJson<GitHubCommitSummary[]>(fetchImpl, '/commits?per_page=1', token);
  const headSha = latest[0]?.sha?.toLowerCase() || '';
  if (!SHA_PATTERN.test(headSha)) throw new Error('WinGet change feed returned an invalid head SHA');

  if (baseSha) {
    const normalizedBase = baseSha.toLowerCase();
    if (!SHA_PATTERN.test(normalizedBase)) throw new Error('Stored WinGet cursor SHA is invalid');
    const changes = await compare(fetchImpl, normalizedBase, headSha, token);
    return { baseSha: normalizedBase, headSha, ...changes, initialized: false };
  }

  const recent = await githubJson<GitHubCommitSummary[]>(
    fetchImpl,
    `/commits?per_page=100&since=${encodeURIComponent(since)}`,
    token
  );
  if (recent.length === 0) {
    return {
      baseSha: null,
      headSha,
      changedFiles: 0,
      changedPackageIds: [],
      initialized: true,
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
  return { baseSha: oldestParent, headSha, ...changes, initialized: true };
}
