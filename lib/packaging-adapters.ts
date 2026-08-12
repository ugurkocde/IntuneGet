import type { ProcessToClose, PSADTConfig } from '@/types/psadt';
import type { WingetScope } from '@/types/winget';

interface ApplicationPackagingAdapter {
  wingetId: string;
  requiredInstallScope?: WingetScope;
  requiredProcessesToClose?: readonly ProcessToClose[];
  reviewedInstallArguments?: readonly string[];
  reviewedUninstallArguments?: readonly string[];
  uninstallCompletionTimeoutMinutes?: number;
  preserveVendorInstallationOnUninstall?: boolean;
}

const VISUAL_STUDIO_WINGET_IDS = [
  'Microsoft.VisualStudio.BuildTools',
  'Microsoft.VisualStudio.Community',
  'Microsoft.VisualStudio.Enterprise',
  'Microsoft.VisualStudio.Professional',
  'Microsoft.VisualStudio.2019.BuildTools',
  'Microsoft.VisualStudio.2019.Community',
  'Microsoft.VisualStudio.2019.Enterprise',
  'Microsoft.VisualStudio.2019.Professional',
  'Microsoft.VisualStudio.2022.BuildTools',
  'Microsoft.VisualStudio.2022.Community',
  'Microsoft.VisualStudio.2022.Enterprise',
  'Microsoft.VisualStudio.2022.Professional',
] as const;

const SSMS_VISUAL_STUDIO_INSTALLER_WINGET_IDS = [
  'Microsoft.SQLServerManagementStudio.21',
  'Microsoft.SQLServerManagementStudio.22',
  'Microsoft.SQLServerManagementStudio.22.Preview',
] as const;

/**
 * Reviewed application-specific behavior that cannot be derived safely from a
 * WinGet manifest. Keep this registry declarative: executable implementation
 * remains in the shared PSADT packagers and every effective value is included
 * in the QA execution-profile hash.
 */
export const APPLICATION_PACKAGING_ADAPTERS: readonly ApplicationPackagingAdapter[] = [
  {
    // Zalo's NSIS bootstrapper is per-user even though its WinGet manifest
    // currently omits Scope. Under LocalSystem it registers a disposable
    // systemprofile path and leaves no usable vendor uninstaller.
    wingetId: 'VNGCorp.Zalo',
    requiredInstallScope: 'user',
  },
  {
    // xTool Studio's NSIS bootstrapper likewise installs below the invoking
    // account's LocalAppData even when the WinGet manifest is selected as a
    // machine package. LocalSystem therefore registers an uninstaller below
    // systemprofile that is unavailable for the later Intune removal cycle.
    wingetId: 'Makeblock.xToolStudio',
    requiredInstallScope: 'user',
  },
  {
    // Analog Devices documents this enterprise/server mode for silent SYSTEM
    // deployment. It prevents the MSI from extracting example data into the
    // LocalSystem AppData profile, which otherwise rolls back with exit 1603.
    wingetId: 'AnalogDevices.LTspice',
    reviewedInstallArguments: ['MY_SPECIAL_MODE=2'],
  },
  {
    wingetId: 'RARLab.WinRAR',
    reviewedUninstallArguments: ['/S'],
  },
  {
    wingetId: 'SoftwareOK.Q-Dir',
    reviewedUninstallArguments: ['/silent', 'forall'],
  },
  {
    wingetId: 'PostgreSQL.PostgreSQL.18',
    reviewedUninstallArguments: ['--mode', 'unattended', '--unattendedmodeui', 'none'],
  },
  {
    // Opera registers `opera.exe --uninstall`, which waits for confirmation
    // unless --runimmediately is supplied. Opera removed support for its old
    // silent switch, so use the vendor's current unattended-start argument
    // without deleting user profiles. Close the browser first so both upgrades
    // and removals can complete deterministically.
    wingetId: 'Opera.Opera',
    requiredProcessesToClose: [
      { name: 'opera', description: 'Opera browser' },
    ],
    reviewedUninstallArguments: ['--runimmediately'],
  },
  {
    // The Evergreen WebView2 Runtime is shared by every WebView2 application,
    // automatically serviced by Microsoft, and preinstalled on Windows 11.
    // Removing the shared runtime can break unrelated applications, while the
    // Windows 11 registration can remain even after its vendor command exits.
    // IntuneGet accepts an exact preinstalled identity at the requested or a
    // newer version, then removes only its own management marker on uninstall.
    wingetId: 'Microsoft.EdgeWebView2Runtime',
    preserveVendorInstallationOnUninstall: true,
  },
  ...VISUAL_STUDIO_WINGET_IDS.map((wingetId) => ({
    wingetId,
    reviewedUninstallArguments: ['--quiet', '--norestart'],
    // Visual Studio's registered setup.exe command returns before its child
    // installer engine has removed the exact product registration. Microsoft
    // documents --wait for the bootstrapper only, not setup.exe, so retain
    // registry-aware completion polling for this longer vendor lifecycle.
    uninstallCompletionTimeoutMinutes: 15,
  })),
  ...SSMS_VISUAL_STUDIO_INSTALLER_WINGET_IDS.map((wingetId) => ({
    wingetId,
    // SSMS 21+ is serviced by the Visual Studio Installer. Its setup.exe
    // parent can return while the installer engine is still removing the
    // product, so keep exact ARP polling active for the longer lifecycle.
    // --noweb is part of Microsoft's documented SSMS removal command and
    // prevents an unnecessary installer update check during unattended runs.
    reviewedUninstallArguments: ['--quiet', '--norestart', '--noweb'],
    uninstallCompletionTimeoutMinutes: 15,
  })),
  {
    wingetId: 'Adobe.CreativeCloud',
    requiredProcessesToClose: [
      { name: 'Creative Cloud', description: 'Adobe Creative Cloud' },
      { name: 'AdobeDesktopService', description: 'Adobe Desktop Service' },
      { name: 'AdobeCEFHelper', description: 'Adobe CEF Helper' },
      { name: 'AdobeInstaller', description: 'Adobe Installer' },
      { name: 'AdobeUpdateService', description: 'Adobe Update Service' },
      { name: 'CCLibrary', description: 'Adobe Creative Cloud Library' },
      { name: 'CCXProcess', description: 'Adobe Creative Cloud Experience' },
      { name: 'CoreSync', description: 'Adobe CoreSync' },
      { name: 'AdobeIPCBroker', description: 'Adobe IPC Broker' },
      { name: 'AdobeNotificationClient', description: 'Adobe Notification Client' },
      { name: 'CreativeCloudHelper', description: 'Adobe Creative Cloud Helper' },
    ],
  },
  {
    wingetId: 'Elgato.StreamDeck',
    requiredProcessesToClose: [
      { name: 'StreamDeck', description: 'Elgato Stream Deck' },
    ],
  },
  {
    wingetId: 'Greenshot.Greenshot',
    requiredProcessesToClose: [
      { name: 'Greenshot', description: 'Greenshot' },
    ],
  },
  {
    // Qfinder Pro starts its desktop process after a silent install. Close it
    // before removal so the NSIS uninstaller can delete the product instead
    // of waiting behind the running application or its startup-error dialog.
    wingetId: 'QNAP.QfinderPro',
    requiredProcessesToClose: [
      { name: 'QfinderPro', description: 'QNAP Qfinder Pro' },
    ],
  },
  {
    wingetId: 'OCSInventoryNG.WindowsAgent',
    requiredProcessesToClose: [
      { name: 'OcsSystray', description: 'OCS Inventory system tray' },
      { name: 'OcsService', description: 'OCS Inventory service' },
      { name: 'OCSInventory', description: 'OCS Inventory agent' },
      { name: 'download', description: 'OCS Inventory download helper' },
    ],
  },
];

function applicationPackagingAdapter(
  wingetId: string
): ApplicationPackagingAdapter | undefined {
  const normalizedWingetId = wingetId.trim().toLowerCase();
  return APPLICATION_PACKAGING_ADAPTERS.find(
    ({ wingetId: adapterWingetId }) => adapterWingetId.toLowerCase() === normalizedWingetId
  );
}

export function resolveApplicationInstallScope(
  wingetId: string,
  requestedScope?: string | null
): WingetScope {
  const requested = requestedScope?.trim().toLowerCase() === 'user' ? 'user' : 'machine';
  return applicationPackagingAdapter(wingetId)?.requiredInstallScope || requested;
}

function normalizeProcessName(name: string): string {
  return name.trim().replace(/\.exe$/i, '');
}

function normalizeReviewedArgument(argument: string, wingetId: string): string {
  const normalized = argument.trim();
  if (!normalized || normalized.length > 256 || /[\x00-\x1f\x7f]/.test(normalized)) {
    throw new Error(`Invalid reviewed uninstall argument for ${wingetId}`);
  }
  return normalized;
}

export function applyApplicationPackagingAdapter(
  wingetId: string,
  config: PSADTConfig
): PSADTConfig {
  const adapter = applicationPackagingAdapter(wingetId);
  if (!adapter) {
    // This internal switch is never accepted from customer-controlled config.
    if (!config.preserveVendorInstallationOnUninstall) return config;
    return { ...config, preserveVendorInstallationOnUninstall: undefined };
  }

  const processesToClose = (config.processesToClose || []).map((process) => {
    const name = normalizeProcessName(process.name);
    if (!name) {
      throw new Error(`Invalid empty PSADT process name for ${adapter.wingetId}`);
    }
    return { ...process, name };
  });
  const configuredNames = new Set(
    processesToClose.map(({ name }) => name.toLowerCase())
  );

  for (const required of adapter.requiredProcessesToClose || []) {
    const normalizedName = normalizeProcessName(required.name);
    if (!configuredNames.has(normalizedName.toLowerCase())) {
      processesToClose.push({ ...required, name: normalizedName });
      configuredNames.add(normalizedName.toLowerCase());
    }
  }

  const reviewedInstallArguments = (config.reviewedInstallArguments || []).map(
    (argument) => normalizeReviewedArgument(argument, adapter.wingetId)
  );
  const configuredInstallArguments = new Set(
    reviewedInstallArguments.map((argument) => argument.toLowerCase())
  );
  for (const required of adapter.reviewedInstallArguments || []) {
    const normalized = normalizeReviewedArgument(required, adapter.wingetId);
    if (!configuredInstallArguments.has(normalized.toLowerCase())) {
      reviewedInstallArguments.push(normalized);
      configuredInstallArguments.add(normalized.toLowerCase());
    }
  }

  const reviewedUninstallArguments = (config.reviewedUninstallArguments || []).map(
    (argument) => normalizeReviewedArgument(argument, adapter.wingetId)
  );
  const configuredArguments = new Set(
    reviewedUninstallArguments.map((argument) => argument.toLowerCase())
  );
  for (const required of adapter.reviewedUninstallArguments || []) {
    const normalized = normalizeReviewedArgument(required, adapter.wingetId);
    if (!configuredArguments.has(normalized.toLowerCase())) {
      reviewedUninstallArguments.push(normalized);
      configuredArguments.add(normalized.toLowerCase());
    }
  }

  return {
    ...config,
    processesToClose,
    reviewedInstallArguments,
    reviewedUninstallArguments,
    ...(adapter.uninstallCompletionTimeoutMinutes
      ? { uninstallCompletionTimeoutMinutes: adapter.uninstallCompletionTimeoutMinutes }
      : {}),
    preserveVendorInstallationOnUninstall:
      adapter.preserveVendorInstallationOnUninstall || undefined,
  };
}
