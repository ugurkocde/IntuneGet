import 'server-only';

export interface GitHubRepoStats {
  stars: number;
  forks: number;
  contributors: number;
}

const GITHUB_REPO = 'ugurkocde/IntuneGet';

// Fallback values used on any fetch error to prevent layout shift
const FALLBACK_STATS: GitHubRepoStats = {
  stars: 100,
  forks: 20,
  contributors: 5,
};

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github.v3+json',
};

/**
 * Fetches stars, forks, and contributor count for the IntuneGet repo.
 * Responses are cached via Next's fetch cache for an hour. On any error the
 * fallback values are returned so the landing page never renders empty stats.
 */
export async function getGitHubRepoStats(): Promise<GitHubRepoStats> {
  try {
    const [repoResponse, contributorsResponse] = await Promise.all([
      fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
        headers: GITHUB_HEADERS,
        next: { revalidate: 3600 },
      }),
      // Contributors count is read from the Link pagination header
      fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contributors?per_page=1&anon=true`,
        {
          headers: GITHUB_HEADERS,
          next: { revalidate: 3600 },
        }
      ),
    ]);

    if (!repoResponse.ok) {
      throw new Error('Failed to fetch GitHub repo stats');
    }

    const repoData = await repoResponse.json();

    let contributorsCount = FALLBACK_STATS.contributors;
    if (contributorsResponse.ok) {
      // Get total from Link header
      const linkHeader = contributorsResponse.headers.get('Link');
      if (linkHeader) {
        const match = linkHeader.match(/page=(\d+)>; rel="last"/);
        if (match) {
          contributorsCount = parseInt(match[1], 10);
        }
      } else {
        // If no pagination, count from response
        const contributorsData = await contributorsResponse.json();
        contributorsCount = Array.isArray(contributorsData)
          ? contributorsData.length
          : FALLBACK_STATS.contributors;
      }
    }

    return {
      stars: repoData.stargazers_count || FALLBACK_STATS.stars,
      forks: repoData.forks_count || FALLBACK_STATS.forks,
      contributors: contributorsCount,
    };
  } catch {
    return { ...FALLBACK_STATS };
  }
}
