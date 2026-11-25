'use client';

import { useCallback } from 'react';
import { useCartStore } from '@/stores/cart-store';
import { generateDetectionRules, generateInstallCommand, generateUninstallCommand } from '@/lib/detection-rules';
import { DEFAULT_PSADT_CONFIG, getDefaultProcessesToClose } from '@/types/psadt';
import type { NormalizedPackage } from '@/types/winget';
import { useUserSettings } from '@/components/providers/UserSettingsProvider';
import { applyPackageDefaults } from '@/lib/package-defaults';

const BATCH_SIZE = 5;

interface BulkAddProgress {
  completed: number;
  total: number;
  current: string;
}

interface BulkAddResult {
  succeeded: string[];
  failed: { id: string; name: string; error: string }[];
}

interface UseBulkAddReturn {
  bulkAdd: (
    packages: NormalizedPackage[],
    onProgress?: (progress: BulkAddProgress) => void
  ) => Promise<BulkAddResult>;
}

export function useBulkAdd(): UseBulkAddReturn {
  const addItemSilent = useCartStore((state) => state.addItemSilent);
  const { packageDefaults, packageDefaultsStatus } = useUserSettings();
  const bulkAdd = useCallback(
    async (
      packages: NormalizedPackage[],
      onProgress?: (progress: BulkAddProgress) => void
    ): Promise<BulkAddResult> => {
      const succeeded: string[] = [];
      const failed: { id: string; name: string; error: string }[] = [];
      let completed = 0;
      if (packageDefaultsStatus === 'loading') {
        return { succeeded, failed: packages.map(pkg => ({ id: pkg.id, name: pkg.name, error: 'Package defaults are still loading' })) };
      }
      const start = useCartStore.getState().activeScope;
      let scopeInvalidated = false;
      const unsubscribe = useCartStore.subscribe((state, previous) => {
        if (state.scope !== previous.scope || state.activeScope !== previous.activeScope) scopeInvalidated = true;
      });
      const assertCurrentScope = () => {
        const current = useCartStore.getState();
        if (scopeInvalidated || (start && (current.scope !== start || current.activeScope !== start))) {
          throw new Error('Account changed during selection. Select the apps again.');
        }
      };

      try {
      // Process in batches
      for (let i = 0; i < packages.length; i += BATCH_SIZE) {
        const batch = packages.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (pkg) => {
            assertCurrentScope();
            onProgress?.({
              completed,
              total: packages.length,
              current: pkg.name,
            });

            const response = await fetch(
              `/api/winget/manifest?id=${encodeURIComponent(pkg.id)}&arch=x64`
            );

            if (!response.ok) {
              throw new Error('Failed to fetch installers');
            }

            const data = await response.json();
            assertCurrentScope();
            const installer = data.recommendedInstaller;

            if (!installer) {
              throw new Error('No compatible installer found');
            }

            const detectionRules = generateDetectionRules(installer, pkg.name, pkg.id, pkg.version);
            const processesToClose = getDefaultProcessesToClose(pkg.name, installer.type);

            addItemSilent({
              appSource: 'win32',
              wingetId: pkg.id,
              displayName: pkg.name,
              publisher: pkg.publisher,
              description: pkg.description,
              version: pkg.version,
              architecture: installer.architecture,
              installScope: installer.scope || 'machine',
              installerType: installer.type,
              nestedInstallerType: installer.nestedInstallerType,
              nestedInstallerPath: installer.nestedInstallerPath,
              manifestDependencies: installer.packageDependencies,
              installerUrl: installer.url,
              installerSha256: installer.sha256,
              installCommand: generateInstallCommand(installer, installer.scope || 'machine'),
              uninstallCommand: generateUninstallCommand(installer, pkg.name),
              detectionRules,
              iconPath: pkg.iconPath,
              psadtConfig: applyPackageDefaults({
                ...DEFAULT_PSADT_CONFIG,
                processesToClose,
                detectionRules,
              }, packageDefaults),
            });

            return pkg;
          })
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const pkg = batch[j];
          completed++;

          if (result.status === 'fulfilled') {
            succeeded.push(pkg.name);
          } else {
            failed.push({
              id: pkg.id,
              name: pkg.name,
              error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
            });
          }

          onProgress?.({
            completed,
            total: packages.length,
            current: pkg.name,
          });
        }
      }

      return { succeeded, failed };
      } finally {
        unsubscribe();
      }
    },
    [addItemSilent, packageDefaults, packageDefaultsStatus]
  );

  return { bulkAdd };
}
