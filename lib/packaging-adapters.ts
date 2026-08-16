import type { ProcessToClose, PSADTConfig } from '@/types/psadt';
import type { WingetScope } from '@/types/winget';

interface ApplicationPackagingAdapter {
  wingetId: string;
  requiredInstallScope?: WingetScope;
  requiredProcessesToClose?: readonly ProcessToClose[];
  reviewedInstallArguments?: readonly string[];
  reviewedInstallArgumentsOverride?: string;
  reviewedInstallShieldAdministrativeImage?: Readonly<{
    expectedMsiFileName: string;
  }>;
  reviewedUninstallArguments?: readonly string[];
  reviewedUninstallProcessGuard?: Readonly<{
    processName: string;
    argumentsPattern: string;
    graceSeconds: number;
  }>;
  uninstallCompletionTimeoutMinutes?: number;
  preserveVendorInstallationOnUninstall?: boolean;
  reviewedManagedInstallDirectory?: string;
  reviewedManagedInstallEvidenceFile?: string;
  reviewedManagedInstallCompletionProcess?: string;
  reviewedManagedInstallCompletionTimeoutMinutes?: number;
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
  reviewedRegistryInstallEvidence?: Readonly<{
    keyPath: string;
    valueName: string;
    minimumDword: number;
  }>;
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

const VISUAL_STUDIO_MANAGED_INSTALL_PATHS = {
  'Microsoft.VisualStudio.BuildTools':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\18\\BuildTools',
  'Microsoft.VisualStudio.Community':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\18\\Community',
  'Microsoft.VisualStudio.Enterprise':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\18\\Enterprise',
  'Microsoft.VisualStudio.Professional':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\18\\Professional',
  'Microsoft.VisualStudio.2019.BuildTools':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2019\\BuildTools',
  'Microsoft.VisualStudio.2019.Community':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2019\\Community',
  'Microsoft.VisualStudio.2019.Enterprise':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2019\\Enterprise',
  'Microsoft.VisualStudio.2019.Professional':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2019\\Professional',
  'Microsoft.VisualStudio.2022.BuildTools':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2022\\BuildTools',
  'Microsoft.VisualStudio.2022.Community':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2022\\Community',
  'Microsoft.VisualStudio.2022.Enterprise':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2022\\Enterprise',
  'Microsoft.VisualStudio.2022.Professional':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2022\\Professional',
} as const;

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
    // Youdao's signed NSIS installer requests `asInvoker` and its WinGet
    // manifest omits Scope. Treating that omission as machine scope launches
    // the per-user bootstrapper under LocalSystem, where it exits immediately
    // without creating an application or uninstall registration.
    wingetId: 'Youdao.YoudaoTranslate',
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
    // UHK Agent is built with Electron Builder's assisted NSIS profile
    // (oneClick: false) without perMachine. Electron Builder defaults that
    // profile to per-user installation. WinGet currently omits Scope, so the
    // generic machine default installs below LocalSystem's LocalAppData and
    // registers an unusable systemprofile uninstaller. Keep QA and customer
    // Intune packages in the intended signed-in user context instead.
    wingetId: 'UltimateGadgetLaboratories.UHKAgent',
    requiredInstallScope: 'user',
  },
  {
    // Viber's MSI is declared machine-scope by WinGet, but its Directory
    // table targets LocalAppData. Under LocalSystem that resolves to the
    // system profile and the vendor's VerifyInstalledFiles action rolls the
    // installation back with 1603. Run the same PSADT package in the signed-in
    // user's context so both the application and its uninstall registration
    // belong to the intended user instead of the disposable system profile.
    wingetId: 'Rakuten.Viber',
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
    // PDFsam documents this exact MSI command for managed Windows deployment.
    // WinGet currently publishes /quiet with only SKIPTHANKSPAGE, which can
    // leave the WiX install inactive under non-interactive LocalSystem. Keep
    // the vendor's full property set in both customer and QA packages.
    wingetId: 'PDFsam.PDFsam',
    reviewedInstallArgumentsOverride:
      '/qb /norestart CHECK_FOR_UPDATES=false DONATE_NOTIFICATION=false SKIPTHANKSPAGE=Yes',
  },
  {
    // Apryse documents -q as the unattended Windows uninstall switch for the
    // install4j-based Xodo/PDF Studio family. The registered Xodo PDF Reader
    // command omits it, which leaves the confirmation flow waiting in a
    // non-interactive Intune session. Append the vendor's quiet contract to
    // the exact captured product-specific uninstaller for QA and customers.
    wingetId: 'Apryse.XodoPDFReader',
    reviewedUninstallArguments: ['-q'],
  },
  {
    // Sonos' compressed InstallShield launcher does not reliably install in a
    // non-interactive LocalSystem session. Create the vendor-supported
    // administrative image in the target context, validate its MSI against the
    // manifest-owned product identity, and install that MSI through PSADT for
    // both QA and customers.
    wingetId: 'Sonos.Controller',
    reviewedInstallShieldAdministrativeImage: {
      expectedMsiFileName: 'Sonos.msi',
    },
  },
  {
    // MEGA's installer source makes silent installs current-user by default.
    // Its reviewed /MULTIUSER option selects the AllUsers path required for
    // non-interactive LocalSystem deployment and machine-wide detection.
    wingetId: 'Mega.MEGASync',
    reviewedInstallArgumentsOverride: '/S /MULTIUSER',
  },
  {
    // Google documents that Drive for desktop must be removed through its
    // versioned registered uninstaller with both --silent and --force_stop.
    // The latter is required whenever Drive is running; without it the helper
    // exits asynchronously while the exact ARP product remains installed.
    // Append the documented arguments to the captured version-specific path
    // so QA and customer Intune packages share the same safe lifecycle.
    wingetId: 'Google.GoogleDrive',
    reviewedUninstallArguments: ['--silent', '--force_stop'],
  },
  {
    // Ecosia Browser uses Chromium's setup.exe lifecycle. Its captured ARP
    // command contains --uninstall but omits --force-uninstall, so setup opens
    // the confirmation UI and cannot complete in a non-interactive Intune
    // session. Chromium defines --force-uninstall as the silent removal switch;
    // append it to the exact captured per-user command for QA and customers.
    wingetId: 'Ecosia.EcosiaBrowser',
    reviewedUninstallArguments: ['--force-uninstall'],
  },
  {
    // Dropbox documents /NOLAUNCH for unattended enterprise installs that must
    // not start the client. Its Windows support guidance also requires Dropbox
    // processes to be closed before removal. The registered machine uninstaller
    // needs NSIS /S in addition to its captured /InstallType:MACHINE argument;
    // otherwise it returns while the exact ARP registration remains installed.
    wingetId: 'Dropbox.Dropbox',
    reviewedInstallArgumentsOverride: '/NOLAUNCH',
    reviewedUninstallArguments: ['/S'],
    requiredProcessesToClose: [
      { name: 'Dropbox', description: 'Dropbox' },
    ],
  },
  {
    // AOMEI registers /SILENT as its quiet uninstall contract, but its custom
    // prompts still require Inno message-box and restart suppression under
    // SYSTEM. Preserve /SILENT and add the companion unattended switches; the
    // generic normalization path must not replace the registered quiet mode.
    wingetId: 'AOMEI.PartitionAssistant',
    requiredProcessesToClose: [
      { name: 'PartAssist', description: 'AOMEI Partition Assistant' },
    ],
    reviewedExactUninstall: {
      executablePath:
        '%ProgramFiles(x86)%\\AOMEI Partition Assistant\\unins000.exe',
      arguments: ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'],
      completionTimeoutMinutes: 5,
    },
  },
  {
    // Bitvise uses its own unattended switch rather than the generic /S that
    // WinGet currently publishes. The vendor documents -unat together with
    // explicit EULA acceptance for scripted installation.
    wingetId: 'Bitvise.SSH.Client',
    reviewedInstallArgumentsOverride: '-unat -acceptEula',
    reviewedUninstallArguments: ['-unat'],
  },
  {
    // Evernote's machine-wide NSIS installer can launch the desktop client
    // before the later removal cycle. Its registered uninstaller exits without
    // removing the exact ARP entry while that client is still running, even
    // with NSIS /S. Close every Evernote process through PSADT before install,
    // upgrade, or uninstall so the vendor's silent lifecycle can complete.
    wingetId: 'Evernote.Evernote',
    requiredProcessesToClose: [
      { name: 'Evernote', description: 'Evernote' },
    ],
  },
  {
    // Link Controller remains active in the notification area after its UI is
    // closed, and its optional camera helper can hold the Inno installation
    // directory open. The silent uninstaller then exits without removing the
    // exact ARP registration. Close only Insta360's reviewed process family
    // through PSADT before invoking the captured vendor uninstaller.
    wingetId: 'Insta360.Link.Controller',
    requiredProcessesToClose: [
      { name: 'Insta360 Link Controller', description: 'Insta360 Link Controller' },
      { name: 'VirtualCameraService', description: 'Insta360 Virtual Camera' },
      { name: 'Insta360LinkDriver', description: 'Insta360 Link driver' },
    ],
  },
  {
    // Logitech's own removal guidance requires the SetPoint notification-area
    // client to be exited first. Under non-interactive LocalSystem the generic
    // NSIS /S uninstaller otherwise removes part of the product but leaves the
    // SetPoint 6.90 ARP identity and payload behind. Close the reviewed SetPoint
    // client family through PSADT before invoking the captured vendor removal.
    wingetId: 'Logitech.SetPoint',
    requiredProcessesToClose: [
      { name: 'SetPoint', description: 'Logitech SetPoint' },
      { name: 'SetPointII', description: 'Logitech SetPoint' },
      { name: 'KHALMNPR', description: 'Logitech SetPoint device service' },
    ],
  },
  {
    // AnyDesk's ARP entry can invoke its interactive removal path, which exits
    // without removing the product under Intune's non-interactive SYSTEM
    // context. AnyDesk documents this exact CLI contract for automated silent
    // removal. Close the desktop/service process family first, then keep the
    // captured ARP identity as the authoritative completion signal.
    wingetId: 'AnyDesk.AnyDesk',
    requiredProcessesToClose: [
      { name: 'AnyDesk', description: 'AnyDesk' },
    ],
    reviewedExactUninstall: {
      executablePath: '%ProgramFiles(x86)%\\AnyDesk\\AnyDesk.exe',
      arguments: ['--silent', '--remove'],
      completionTimeoutMinutes: 5,
    },
  },
  {
    wingetId: 'RARLab.WinRAR',
    reviewedUninstallArguments: ['/S'],
  },
  {
    // REAPER registers an interactive uninstall command without a separate
    // QuietUninstallString. Its vendor installer and uninstaller both accept
    // the manifest's case-sensitive /S switch; without it, a SYSTEM removal
    // waits behind the hidden uninstall wizard and leaves the ARP identity.
    wingetId: 'Cockos.REAPER',
    reviewedUninstallArguments: ['/S'],
  },
  {
    wingetId: 'SoftwareOK.Q-Dir',
    reviewedUninstallArguments: ['/silent', 'forall'],
  },
  {
    // DWG FastView registers setup.exe without a separate quiet uninstall
    // command. Version 9.10's current WinGet manifest uses /s for unattended
    // setup, while a /silent /uninstall trial left the exact
    // DWGFastView_en_ww registration installed under SYSTEM. Pair the current
    // silent switch with setup.exe's established /uninstall lifecycle on this
    // exact package so QA and customer Intune packages exercise the same path.
    wingetId: 'Gstarsoft.DWGFastView',
    reviewedUninstallArguments: ['/s', '/uninstall'],
  },
  {
    // Dell Optimizer's registered InstallShield helper exits without removing
    // the product even with Dell's documented switches. Invoke the original,
    // hash-verified Dell Update Package instead; Dell documents the
    // /passthrough /silent /remove lifecycle for this outer package.
    wingetId: 'Dell.Optimizer',
    reviewedExactUninstall: {
      executablePath: '%PackageInstaller%',
      arguments: ['/passthrough', '/silent', '/remove'],
      completionTimeoutMinutes: 10,
    },
  },
  {
    // DDPM registers its private setup helper with interactive removal
    // arguments. Replaying that ARP command from Intune leaves the exact
    // product registration, services, and drivers installed. Stop the reviewed
    // DDPM process family, then invoke the installed helper's unattended
    // uninstall contract exactly. Customer packaging remains QA-gated, so a
    // new version cannot inherit this lifecycle until isolated removal passes.
    wingetId: 'Dell.DisplayAndPeripheralManager',
    requiredProcessesToClose: [
      { name: 'DDPM.Subagent', description: 'Dell Display and Peripheral Manager' },
      { name: 'DDPM.Subagent.User', description: 'Dell Display and Peripheral Manager' },
      { name: 'Dell.CoreServices.Client', description: 'Dell Core Services' },
      { name: 'Dell.TechHub.Analytics.SubAgent', description: 'Dell TechHub' },
      { name: 'Dell.TechHub.DataManager.SubAgent', description: 'Dell TechHub' },
      { name: 'Dell.TechHub', description: 'Dell TechHub' },
      { name: 'Dell.TechHub.Instrumentation.SubAgent', description: 'Dell TechHub' },
      { name: 'Dell.TechHub.Instrumentation.UserProcess', description: 'Dell TechHub' },
      { name: 'Dell.UCA.Manager', description: 'Dell Update' },
      { name: 'Dell.Update.SubAgent', description: 'Dell Update' },
      { name: 'DPM', description: 'Dell Display and Peripheral Manager' },
      { name: 'DPMCrashHandler', description: 'Dell Display and Peripheral Manager' },
      { name: 'DPMService', description: 'Dell Display and Peripheral Manager' },
    ],
    reviewedExactUninstall: {
      executablePath:
        '%ProgramFiles%\\Dell\\Dell Display and Peripheral Manager\\Installer\\setup.exe',
      arguments: ['/uninst', '/Silent'],
      completionTimeoutMinutes: 20,
    },
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
    // Opera GX uses the same launcher contract as the standard Opera browser,
    // but installs into its own machine-wide directory. Its registered slash
    // command can exit without removing the browser, leaving the exact ARP
    // identity behind. Invoke Opera's reviewed double-dash lifecycle directly
    // and preserve the user profile during managed removal.
    wingetId: 'Opera.OperaGX',
    requiredProcessesToClose: [
      { name: 'opera', description: 'Opera GX browser' },
    ],
    reviewedExactUninstall: {
      executablePath: '%ProgramFiles%\\Opera GX\\opera.exe',
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
    // HP Image Assistant is distributed as a SoftPaq extractor rather than an
    // ARP-installed application. Its reviewed WinGet command extracts the
    // portable payload to this exact machine-wide SWSetup directory. Verify
    // and own only that directory instead of requiring a nonexistent vendor
    // uninstall registration.
    wingetId: 'HP.ImageAssistant',
    reviewedManagedInstallDirectory: '%SystemDrive%\\SWSetup\\HPImageAssistant',
  },
  {
    // Navisworks Freedom 2026 is installed by Autodesk ODIS. The bootstrapper
    // changes multiple Autodesk registrations, so a generic ARP capture cannot
    // identify the product safely. Autodesk documents the ODIS manifest-based
    // uninstall workflow, and this product GUID is also the exact GUID in the
    // vendor installer URL published by WinGet.
    wingetId: 'Autodesk.NavisworksFreedom.2026',
    reviewedManagedInstallDirectory:
      '%ProgramW6432%\\Autodesk\\Navisworks Freedom 2026',
    reviewedManagedInstallEvidenceFile:
      '%ProgramW6432%\\Autodesk\\Navisworks Freedom 2026\\Roamer.exe',
    reviewedManagedInstallCompletionProcess:
      '%ProgramW6432%\\Autodesk\\AdODIS\\V1\\Installer.exe',
    reviewedManagedInstallCompletionTimeoutMinutes: 15,
    reviewedManagedUninstall: {
      executablePath: '%ProgramW6432%\\Autodesk\\AdODIS\\V1\\Installer.exe',
      arguments: [
        '-i',
        'uninstall',
        '--silent',
        '--trigger_point',
        'system',
        '-m',
        '%ProgramData%\\Autodesk\\ODIS\\metadata\\{BE06C262-73A9-3C2F-8982-C105E1EE9A34}\\bundleManifest.xml',
        '-x',
        '%ProgramData%\\Autodesk\\ODIS\\metadata\\{BE06C262-73A9-3C2F-8982-C105E1EE9A34}\\SetupRes\\manifest.xsd',
      ],
      completionTimeoutMinutes: 15,
    },
  },
  {
    // Navisworks Freedom 2027 uses the same documented ODIS lifecycle with a
    // release-specific manifest GUID from Autodesk's WinGet installer URL.
    wingetId: 'Autodesk.NavisworksFreedom.2027',
    reviewedManagedInstallDirectory:
      '%ProgramW6432%\\Autodesk\\Navisworks Freedom 2027',
    reviewedManagedInstallEvidenceFile:
      '%ProgramW6432%\\Autodesk\\Navisworks Freedom 2027\\Roamer.exe',
    reviewedManagedInstallCompletionProcess:
      '%ProgramW6432%\\Autodesk\\AdODIS\\V1\\Installer.exe',
    reviewedManagedInstallCompletionTimeoutMinutes: 15,
    reviewedManagedUninstall: {
      executablePath: '%ProgramW6432%\\Autodesk\\AdODIS\\V1\\Installer.exe',
      arguments: [
        '-i',
        'uninstall',
        '--silent',
        '--trigger_point',
        'system',
        '-m',
        '%ProgramData%\\Autodesk\\ODIS\\metadata\\{52AC45A2-3099-370C-8394-8B347967768B}\\bundleManifest.xml',
        '-x',
        '%ProgramData%\\Autodesk\\ODIS\\metadata\\{52AC45A2-3099-370C-8394-8B347967768B}\\SetupRes\\manifest.xsd',
      ],
      completionTimeoutMinutes: 15,
    },
  },
  {
    // Google Updater is a shared system updater, not a conventional ARP app.
    // Its enterprise installer can update an existing registration without
    // creating a new uninstall entry, so ARP delta capture is not a reliable
    // lifecycle identity. Verify Google's machine-wide payload and invoke the
    // documented versioned updater command during managed removal.
    wingetId: 'Google.GoogleUpdater',
    reviewedManagedInstallDirectory:
      '%ProgramFiles(x86)%\\Google\\GoogleUpdater',
    reviewedManagedUninstall: {
      executablePath:
        '%ProgramFiles(x86)%\\Google\\GoogleUpdater\\<VERSION>\\updater.exe',
      arguments: ['--uninstall', '--system'],
      completionTimeoutMinutes: 5,
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
    // .NET Framework 4.8.1 is a shared Windows runtime and does not expose one
    // dependable ARP identity. Microsoft documents the Full\Release DWORD as
    // the authoritative version signal; 533320 is the minimum for 4.8.1.
    // Keep the runtime during Intune removal and remove only our marker.
    wingetId: 'Microsoft.DotNet.Framework.Runtime',
    preserveVendorInstallationOnUninstall: true,
    reviewedRegistryInstallEvidence: {
      keyPath: 'HKLM:\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full',
      valueName: 'Release',
      minimumDword: 533320,
    },
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
  ...Object.entries(VISUAL_STUDIO_MANAGED_INSTALL_PATHS).map(
    ([wingetId, installPath]) => ({
      // Visual Studio Installer instances create several component records,
      // not one reliable ARP delta named after the bootstrapper. Verify the
      // exact edition directory and use Microsoft's setup.exe instance
      // lifecycle for every supported Visual Studio generation and edition.
      wingetId,
      reviewedManagedInstallDirectory: installPath,
      reviewedManagedUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
        arguments: [
          'uninstall',
          '--installPath',
          installPath,
          '--quiet',
          '--norestart',
        ],
        completionTimeoutMinutes: 15,
      },
    })
  ),
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

const REVIEWED_REGISTRY_UNINSTALL_IDENTITIES: Readonly<Record<string, Readonly<{
  generatedDisplayName: string;
  registeredDisplayName: string;
  registeredRegistryKey?: string;
}>>> = {
  // The EXE package's catalog name distinguishes it from Google.Chrome, but
  // Google's machine installer registers the ordinary `Google Chrome` ARP
  // identity. Keep that exact vendor identity for capture, verification, and
  // Intune removal instead of weakening the generic one-product matcher.
  'google.chrome.exe': {
    generatedDisplayName: 'Google Chrome (EXE)',
    registeredDisplayName: 'Google Chrome',
  },
  // K-Lite inserts the version between the family and edition in DisplayName
  // (for example `K-Lite Codec Pack 19.9.0 Standard`). All four mutually
  // exclusive editions use the same stable Inno registry key, so use that
  // exact vendor identity instead of weakening the generic display-name
  // matcher to a broad prefix search that also captures unrelated servicing.
  'codecguide.k-litecodecpack.basic': {
    generatedDisplayName: 'K-Lite Codec Pack Basic',
    registeredDisplayName: 'K-Lite Codec Pack Basic',
    registeredRegistryKey: 'KLiteCodecPack_is1',
  },
  'codecguide.k-litecodecpack.standard': {
    generatedDisplayName: 'K-Lite Codec Pack Standard',
    registeredDisplayName: 'K-Lite Codec Pack Standard',
    registeredRegistryKey: 'KLiteCodecPack_is1',
  },
  'codecguide.k-litecodecpack.full': {
    generatedDisplayName: 'K-Lite Codec Pack Full',
    registeredDisplayName: 'K-Lite Codec Pack Full',
    registeredRegistryKey: 'KLiteCodecPack_is1',
  },
  'codecguide.k-litecodecpack.mega': {
    generatedDisplayName: 'K-Lite Codec Pack Mega',
    registeredDisplayName: 'K-Lite Codec Pack Mega',
    registeredRegistryKey: 'KLiteCodecPack_is1',
  },
  // Maestro's signed EXE wraps an MSI whose authoritative ProductCode is not
  // published in the WinGet manifest. The wrapper updates that existing ARP
  // key rather than adding a new display-name entry. Bind the reviewed key so
  // both customer packages and QA verify and remove the exact MSI product.
  'maestrosoft.maestroaarsoppgjoer.2025': {
    generatedDisplayName: 'Maestro Årsoppgjør 2025',
    registeredDisplayName: 'Maestro Årsoppgjør 2025',
    registeredRegistryKey: '{20C36C0E-AF6D-4C46-AA1C-39080889BE9F}',
  },
  // Timely publishes the stable NSIS uninstall registry key as ProductCode
  // `Memory`. It is not an MSI GUID, so the generic manifest conversion treats
  // it as a display name and misses the vendor entry when background servicing
  // changes unrelated ARP records at the same time. Bind the published key so
  // install verification, the Intune marker, and removal all use one exact
  // user-scoped identity.
  'timely.memory': {
    generatedDisplayName: 'Memory',
    registeredDisplayName: 'Memory',
    registeredRegistryKey: 'Memory',
  },
};

export function resolveApplicationUninstallCommand(
  wingetId: string,
  uninstallCommand: string
): string {
  const reviewed = REVIEWED_REGISTRY_UNINSTALL_IDENTITIES[wingetId.trim().toLowerCase()];
  if (!reviewed) return uninstallCommand;
  const expected = `REGISTRY_UNINSTALL:${reviewed.generatedDisplayName}`;
  if (uninstallCommand.trim() !== expected) return uninstallCommand;
  return reviewed.registeredRegistryKey
    ? `REGISTRY_UNINSTALL_KEY:${reviewed.registeredRegistryKey}:${reviewed.registeredDisplayName}`
    : `REGISTRY_UNINSTALL:${reviewed.registeredDisplayName}`;
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
      !config.reviewedInstallArgumentsOverride &&
      !config.reviewedInstallShieldAdministrativeImage &&
      !config.reviewedMultiProductInstallDisplayNamePrefixes &&
      !config.reviewedMultiProductInstallMinimumCount &&
      !config.reviewedRegistryInstallEvidence &&
      !config.reviewedUninstallProcessGuard &&
      !config.reviewedManagedInstallDirectory &&
      !config.reviewedManagedInstallEvidenceFile &&
      !config.reviewedManagedInstallCompletionProcess &&
      !config.reviewedManagedInstallCompletionTimeoutMinutes &&
      !config.reviewedManagedUninstall &&
      !config.reviewedExactUninstall
    ) return config;
    return {
      ...config,
      preserveVendorInstallationOnUninstall: undefined,
      reviewedInstallArgumentsOverride: undefined,
      reviewedInstallShieldAdministrativeImage: undefined,
      reviewedMultiProductInstallDisplayNamePrefixes: undefined,
      reviewedMultiProductInstallMinimumCount: undefined,
      reviewedRegistryInstallEvidence: undefined,
      reviewedUninstallProcessGuard: undefined,
      reviewedManagedInstallDirectory: undefined,
      reviewedManagedInstallEvidenceFile: undefined,
      reviewedManagedInstallCompletionProcess: undefined,
      reviewedManagedInstallCompletionTimeoutMinutes: undefined,
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

  const reviewedInstallArgumentsOverride = adapter.reviewedInstallArgumentsOverride
    ? normalizeReviewedArgument(
        adapter.reviewedInstallArgumentsOverride,
        adapter.wingetId
      )
    : undefined;

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
    reviewedInstallArgumentsOverride,
    installCommand: adapter.reviewedInstallShieldAdministrativeImage
      ? undefined
      : config.installCommand,
    reviewedInstallShieldAdministrativeImage:
      adapter.reviewedInstallShieldAdministrativeImage
      ? { ...adapter.reviewedInstallShieldAdministrativeImage }
      : undefined,
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
    reviewedManagedInstallEvidenceFile:
      adapter.reviewedManagedInstallEvidenceFile || undefined,
    reviewedManagedInstallCompletionProcess:
      adapter.reviewedManagedInstallCompletionProcess || undefined,
    reviewedManagedInstallCompletionTimeoutMinutes:
      adapter.reviewedManagedInstallCompletionTimeoutMinutes,
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
    reviewedRegistryInstallEvidence: adapter.reviewedRegistryInstallEvidence
      ? { ...adapter.reviewedRegistryInstallEvidence }
      : undefined,
  };
}
