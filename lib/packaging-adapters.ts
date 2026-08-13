import type { ProcessToClose, PSADTConfig } from '@/types/psadt';
import type { WingetScope } from '@/types/winget';

interface ApplicationPackagingAdapter {
  wingetId: string;
  requiredInstallScope?: WingetScope;
  requiredProcessesToClose?: readonly ProcessToClose[];
  reviewedInstallArguments?: readonly string[];
  reviewedUninstallArguments?: readonly string[];
  reviewedUninstallProcessGuard?: Readonly<{
    processName: string;
    argumentsPattern: string;
    graceSeconds: number;
  }>;
  uninstallCompletionTimeoutMinutes?: number;
  preserveVendorInstallationOnUninstall?: boolean;
  reviewedManagedInstallDirectory?: string;
  reviewedManagedUninstall?: Readonly<{
    executablePath: string;
    arguments: readonly string[];
    completionTimeoutMinutes: number;
  }>;
  reviewedExactUninstall?: Readonly<{
    executablePath: string;
    arguments: readonly string[];
    completionTimeoutMinutes: number;
  }>;
  reviewedMultiProductInstallDisplayNamePrefixes?: readonly string[];
  reviewedMultiProductInstallMinimumCount?: number;
}

const POSTGRESQL_PACKAGING_ADAPTER: ApplicationPackagingAdapter = {
  // EnterpriseDB's registered uninstaller is interactive unless BitRock's
  // unattended mode is supplied. Apply this to every versioned PostgreSQL
  // package ID so a new major release cannot silently lose the lifecycle fix.
  wingetId: 'PostgreSQL.PostgreSQL.*',
  reviewedUninstallArguments: [
    '--mode',
    'unattended',
    '--unattendedmodeui',
    'none',
  ],
};

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
    // Opera registers `opera.exe /uninstall`, but its current launcher expects
    // the double-dash uninstall verb for a non-interactive removal. Appending
    // unattended arguments to the registered slash command exits successfully
    // without removing the application. Execute the reviewed launcher command
    // exactly and retain the captured ARP identity as the completion signal.
    // Opera removes its browser registration but intentionally leaves a small
    // assistant payload, so directory disappearance would be a false failure.
    // Keep the browser profile and close it before upgrades/removals.
    wingetId: 'Opera.Opera',
    requiredProcessesToClose: [
      { name: 'opera', description: 'Opera browser' },
    ],
    reviewedExactUninstall: {
      executablePath: '%ProgramFiles%\\Opera\\opera.exe',
      arguments: ['--uninstall', '--runimmediately', '--deleteuserprofile=0'],
      completionTimeoutMinutes: 5,
    },
  },
  {
    // The Office Deployment Tool is a self-extracting payload, not an
    // installed application. It intentionally creates no ARP registration.
    // WinGet extracts it to this machine-wide directory, so verify that exact
    // payload and remove it directly instead of capturing an unrelated ARP
    // change made by Windows servicing during the extraction.
    wingetId: 'Microsoft.OfficeDeploymentTool',
    reviewedManagedInstallDirectory: '%ProgramW6432%\\OfficeDeploymentTool',
  },
  {
    // Visual Studio 2026 instances are owned by the Visual Studio Installer,
    // which intentionally creates several component registrations rather than
    // one ARP entry named after the bootstrapper. Use Microsoft's documented
    // instance path and setup.exe lifecycle instead of guessing among those
    // registrations.
    wingetId: 'Microsoft.VisualStudio.BuildTools',
    reviewedManagedInstallDirectory:
      '%ProgramFiles(x86)%\\Microsoft Visual Studio\\18\\BuildTools',
    reviewedManagedUninstall: {
      executablePath:
        '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
      arguments: [
        'uninstall',
        '--installPath',
        '%ProgramFiles(x86)%\\Microsoft Visual Studio\\18\\BuildTools',
        '--quiet',
        '--norestart',
      ],
      completionTimeoutMinutes: 15,
    },
  },
  {
    // EA Desktop's registered EAUninstall.exe helper is unattended, but it
    // leaves the product registration intact while the client or its
    // background service still owns the installation. Close the reviewed EA
    // process family before both upgrades and Intune removal so the exact
    // registered helper can complete under LocalSystem.
    wingetId: 'ElectronicArts.EADesktop',
    requiredProcessesToClose: [
      { name: 'EADesktop', description: 'EA app' },
      { name: 'EALauncher', description: 'EA app launcher' },
      { name: 'EACefSubProcess', description: 'EA app web process' },
      { name: 'EALocalHostSvc', description: 'EA local host service' },
      { name: 'EABackgroundService', description: 'EA background service' },
    ],
  },
  {
    // Camera Hub starts its desktop process after MSI installation. The MSI
    // Pre_Uninstall custom action launches a new Camera Hub helper with
    // --pre-uninstall --quit and can wait indefinitely even after the original
    // desktop process is closed. Close the user process first, then allow the
    // reviewed custom-action helper a short grace period before ending only
    // that exact newly spawned command line.
    wingetId: 'Elgato.CameraHub',
    requiredProcessesToClose: [
      { name: 'Camera Hub', description: 'Elgato Camera Hub' },
    ],
    reviewedUninstallProcessGuard: {
      processName: 'Camera Hub.exe',
      argumentsPattern: '(?:^|\\s)--pre-uninstall(?:\\s|$).*--quit(?:\\s|$)',
      graceSeconds: 20,
    },
  },
  {
    // The VSTO redistributable registers a visible External Installer command
    // with no arguments. Invoking that bare install.exe returns successfully
    // without removing the runtime. Supply the redistributable's unattended
    // removal switches so Intune and QA use the same deterministic lifecycle.
    wingetId: 'Microsoft.VSTOR',
    reviewedUninstallArguments: ['/uninstall', '/quiet', '/norestart'],
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
  {
    // VisualCppRedist AIO is intentionally a bundle of independently registered
    // Visual C++ runtimes. Version 104+ creates several unified ARP entries, so
    // no single vendor identity represents the package. These runtimes are also
    // shared prerequisites: Intune removal relinquishes the IntuneGet marker
    // instead of invoking the vendor's /aiR switch, which removes every runtime.
    wingetId: 'abbodi1406.vcredist',
    preserveVendorInstallationOnUninstall: true,
    reviewedMultiProductInstallDisplayNamePrefixes: [
      'Microsoft Visual C++',
      'Visual C++',
    ],
    reviewedMultiProductInstallMinimumCount: 10,
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
  const exactAdapter = APPLICATION_PACKAGING_ADAPTERS.find(
    ({ wingetId: adapterWingetId }) => adapterWingetId.toLowerCase() === normalizedWingetId
  );
  if (exactAdapter) return exactAdapter;
  if (/^postgresql\.postgresql\.\d+(?:\.\d+)?$/.test(normalizedWingetId)) {
    return POSTGRESQL_PACKAGING_ADAPTER;
  }
  return undefined;
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

function normalizeReviewedDisplayNamePrefix(
  prefix: string,
  wingetId: string
): string {
  const normalized = prefix.trim();
  if (!normalized || normalized.length > 128 || /[\x00-\x1f\x7f]/.test(normalized)) {
    throw new Error(`Invalid reviewed install display-name prefix for ${wingetId}`);
  }
  return normalized;
}

export function applyApplicationPackagingAdapter(
  wingetId: string,
  config: PSADTConfig
): PSADTConfig {
  const adapter = applicationPackagingAdapter(wingetId);
  if (!adapter) {
    // These internal lifecycle fields are never accepted from customer config.
    if (
      !config.preserveVendorInstallationOnUninstall &&
      !config.reviewedMultiProductInstallDisplayNamePrefixes &&
      !config.reviewedMultiProductInstallMinimumCount &&
      !config.reviewedUninstallProcessGuard &&
      !config.reviewedManagedInstallDirectory &&
      !config.reviewedManagedUninstall &&
      !config.reviewedExactUninstall
    ) return config;
    return {
      ...config,
      preserveVendorInstallationOnUninstall: undefined,
      reviewedMultiProductInstallDisplayNamePrefixes: undefined,
      reviewedMultiProductInstallMinimumCount: undefined,
      reviewedUninstallProcessGuard: undefined,
      reviewedManagedInstallDirectory: undefined,
      reviewedManagedUninstall: undefined,
      reviewedExactUninstall: undefined,
    };
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

  const reviewedMultiProductInstallDisplayNamePrefixes =
    adapter.reviewedMultiProductInstallDisplayNamePrefixes?.map((prefix) =>
      normalizeReviewedDisplayNamePrefix(prefix, adapter.wingetId)
    );

  return {
    ...config,
    processesToClose,
    reviewedInstallArguments,
    reviewedUninstallArguments,
    reviewedUninstallProcessGuard: adapter.reviewedUninstallProcessGuard
      ? { ...adapter.reviewedUninstallProcessGuard }
      : undefined,
    ...(adapter.uninstallCompletionTimeoutMinutes
      ? { uninstallCompletionTimeoutMinutes: adapter.uninstallCompletionTimeoutMinutes }
      : {}),
    preserveVendorInstallationOnUninstall:
      adapter.preserveVendorInstallationOnUninstall || undefined,
    reviewedManagedInstallDirectory:
      adapter.reviewedManagedInstallDirectory || undefined,
    reviewedManagedUninstall: adapter.reviewedManagedUninstall
      ? {
          executablePath: adapter.reviewedManagedUninstall.executablePath,
          arguments: [...adapter.reviewedManagedUninstall.arguments],
          completionTimeoutMinutes:
            adapter.reviewedManagedUninstall.completionTimeoutMinutes,
        }
      : undefined,
    reviewedExactUninstall: adapter.reviewedExactUninstall
      ? {
          executablePath: adapter.reviewedExactUninstall.executablePath,
          arguments: [...adapter.reviewedExactUninstall.arguments],
          completionTimeoutMinutes:
            adapter.reviewedExactUninstall.completionTimeoutMinutes,
        }
      : undefined,
    reviewedMultiProductInstallDisplayNamePrefixes,
    reviewedMultiProductInstallMinimumCount:
      adapter.reviewedMultiProductInstallMinimumCount,
  };
}
