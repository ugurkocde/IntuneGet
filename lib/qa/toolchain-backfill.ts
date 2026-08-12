export interface QaToolchainBackfillCandidate {
  wingetId: string;
  status: string;
  priority: number;
  enqueuedAt: string;
}

// A packager release should not automatically re-run every known vendor or
// application failure. Record only the apps whose previously failing path is
// changed by the current packager release. Successful and never-tested apps
// continue through the normal compatibility/backfill logic.
const TOOLCHAIN_TERMINAL_RETRY_TARGETS: Readonly<Record<string, readonly string[]>> = {
  '354756f01cb572cfd410f95dd6af5ab3a9cb8efb': [
    'Microsoft.VisualStudio.2019.Enterprise',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'PostgreSQL.PostgreSQL.18',
    'RARLab.WinRAR',
    'SoftwareOK.Q-Dir',
  ],
  'd9b55d1f1717bed2f1119347faf4984fed4eae53': [
    'Microsoft.VisualStudio.2019.Enterprise',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'PostgreSQL.PostgreSQL.18',
    'RARLab.WinRAR',
    'SoftwareOK.Q-Dir',
  ],
  'bafea79a8dde42be074c385c35b4887fb5833aa0': [
    'Oracle.VirtualBox',
  ],
  'acfe2d8692cc2b910281236ff47d3ee5b2ce2b99': [
    'Greenshot.Greenshot',
  ],
  'fc18fffd40f6d362be251e05e2bc784373dfc735': [
    'OCSInventoryNG.WindowsAgent',
  ],
  'ef75edee9fcabaf904bcf80e02ead9aa58490dc9': [
    'Google.Chrome',
    'Yealink.YealinkUSBConnect',
  ],
  '66448ea49841c2c9f3ebf56e455ce8797e2b2abb': ['Google.Chrome'],
  '430f817da1120f6a14f421b7016b628a06854aba': [
    'Adobe.CreativeCloud',
    'Elgato.StreamDeck',
    'Formlabs.PreForm',
  ],
  '99edd0a9f4b7e10d4cc4272f90d763f3bd681440': ['Figma.Figma'],
  'c1fe66c04b11f595bfaf4c9ca7cc1444186ea028': [
    'Figma.Figma',
    'HP.ImageAssistant',
    'Microsoft.Office',
  ],
  '42bf6e2af604a5e6bb44f2feff38e941ab2222c1': [
    'Adobe.CreativeCloud',
    'Elgato.StreamDeck',
  ],
};

export function shouldRetryTerminalToolchainCandidate(
  packagerCommit: string,
  candidate: Pick<QaToolchainBackfillCandidate, 'wingetId' | 'status'>
): boolean {
  if (!['failed', 'error'].includes(candidate.status)) return true;
  return (TOOLCHAIN_TERMINAL_RETRY_TARGETS[packagerCommit] || []).includes(
    candidate.wingetId
  );
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function prioritizeToolchainBackfill(
  candidates: QaToolchainBackfillCandidate[]
): string[] {
  return [...candidates]
    .sort((left, right) => {
      const leftFailureRank = left.status === 'failed' ? 0 : left.status === 'error' ? 1 : 2;
      const rightFailureRank = right.status === 'failed' ? 0 : right.status === 'error' ? 1 : 2;
      if (leftFailureRank !== rightFailureRank) return leftFailureRank - rightFailureRank;
      if (left.priority !== right.priority) return right.priority - left.priority;
      return timestamp(right.enqueuedAt) - timestamp(left.enqueuedAt);
    })
    .map((candidate) => candidate.wingetId);
}
