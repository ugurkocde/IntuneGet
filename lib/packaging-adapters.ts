import type { ProcessToClose, PSADTConfig } from '@/types/psadt';
import type { WingetInstallerType, WingetScope } from '@/types/winget';

interface ApplicationPackagingAdapter {
  wingetId: string;
  requiredInstallScope?: WingetScope;
  reviewedInstallerSelectionScope?: WingetScope;
  reviewedInstallerSelectionType?: WingetInstallerType;
  reviewedInstallerSuccessCodes?: readonly number[];
  requiredProcessesToClose?: readonly ProcessToClose[];
  reviewedInstallArguments?: readonly string[];
  reviewedInstallArgumentsOverride?: string;
  reviewedArgumentlessInstall?: boolean;
  reviewedInstallCompletionTimeoutMinutes?: number;
  reviewedInstallShieldAdministrativeImage?: Readonly<{
    expectedMsiFileName: string;
  }>;
  reviewedUninstallArguments?: readonly string[];
  reviewedUninstallProcessGuard?: Readonly<{
    processName: string;
    argumentsPattern: string;
    graceSeconds: number;
  }>;
  reviewedUninstallServiceNames?: readonly string[];
  uninstallCompletionTimeoutMinutes?: number;
  preserveVendorInstallationOnUninstall?: boolean;
  reviewedPreferVisiblePrimaryUninstallRegistration?: boolean;
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
  reviewedAppxInstallEvidence?: Readonly<{
    packageName: string;
    publisherId: string;
    minimumVersion: string;
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
  // Visual Studio 2022 and newer full IDE editions use Program Files. Build
  // Tools 2022 remains below Program Files (x86), as documented by Microsoft's
  // unattended Build Tools deployment example. The shared Visual Studio
  // Installer also remains below Program Files (x86).
  'Microsoft.VisualStudio.BuildTools':
    '%ProgramFiles%\\Microsoft Visual Studio\\18\\BuildTools',
  'Microsoft.VisualStudio.Community':
    '%ProgramFiles%\\Microsoft Visual Studio\\18\\Community',
  'Microsoft.VisualStudio.Enterprise':
    '%ProgramFiles%\\Microsoft Visual Studio\\18\\Enterprise',
  'Microsoft.VisualStudio.Professional':
    '%ProgramFiles%\\Microsoft Visual Studio\\18\\Professional',
  // Visual Studio 2017 and 2019 are 32-bit products and use the versioned
  // Program Files (x86) instance root on 64-bit Windows.
  'Microsoft.VisualStudio.2017.BuildTools':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2017\\BuildTools',
  'Microsoft.VisualStudio.2017.Community':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2017\\Community',
  'Microsoft.VisualStudio.2017.Enterprise':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2017\\Enterprise',
  'Microsoft.VisualStudio.2017.Professional':
    '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2017\\Professional',
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
    '%ProgramFiles%\\Microsoft Visual Studio\\2022\\Community',
  'Microsoft.VisualStudio.2022.Enterprise':
    '%ProgramFiles%\\Microsoft Visual Studio\\2022\\Enterprise',
  'Microsoft.VisualStudio.2022.Professional':
    '%ProgramFiles%\\Microsoft Visual Studio\\2022\\Professional',
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
    // Amazon's official WinGet submission intentionally declares its user-scope
    // bootstrapper without switches and passed Microsoft's unattended validation
    // (winget-pkgs#94441). Preserve that exact argument-free vendor contract.
    wingetId: 'Amazon.Music',
    reviewedArgumentlessInstall: true,
    // The signed vendor uninstaller removes the app immediately but its exact
    // per-user registration remained for slightly more than ten minutes in
    // isolated QA run 32557346184.
    // Keep waiting for that exact identity rather than reporting failure while
    // the verified removal is still completing.
    uninstallCompletionTimeoutMinutes: 15,
  },
  {
    // ABB documents ADDLOCAL=ALL for a complete unattended RobotStudio
    // installation. The 2025.2 InstallShield wrapper also services Edge while
    // it runs, so keep the long-running nested process observable and bind the
    // resulting package to RobotStudio's exact MSI identity below.
    wingetId: 'ABB.RobotStudio',
    reviewedInstallArgumentsOverride: '/s /v"/qn ADDLOCAL=ALL /norestart"',
    reviewedInstallCompletionTimeoutMinutes: 15,
  },
  {
    // Ava Desktop's NSIS bootstrapper installs below the invoking account's
    // LocalAppData even though its WinGet manifest omits Scope. Running it as
    // LocalSystem records a systemprofile uninstaller that is absent by the
    // removal cycle. Keep the package in the intended signed-in user context.
    wingetId: 'AvaCC.AvaDesktop',
    requiredInstallScope: 'user',
  },
  {
    // ElegantClipboard's tagged Tauri v2 configuration explicitly builds its
    // NSIS installer with installMode=currentUser, while the WinGet manifest
    // omits Scope. The generic machine default installs below LocalSystem's
    // systemprofile and registers an uninstall.exe path that is already absent
    // by the managed removal cycle. Keep the package in the intended signed-in
    // user context so customer deployment and QA share the vendor's lifecycle.
    wingetId: 'Y-ASLant.ElegantClipboard',
    requiredInstallScope: 'user',
  },
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
    // Appium Inspector's own Electron Builder configuration uses assisted NSIS
    // without enabling perMachine. WinGet currently labels the installer as
    // machine scope, which installs into LocalSystem's disposable systemprofile
    // and registers an uninstaller that is unavailable for the later Intune
    // removal cycle. Run the package in the intended signed-in user context.
    wingetId: 'AppiumDevelopers.AppiumInspector',
    requiredInstallScope: 'user',
    // Keep selecting and attesting the exact machine-labelled WinGet bytes;
    // only their execution context is corrected by the reviewed adapter.
    reviewedInstallerSelectionScope: 'machine',
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
    // Tor Browser's official Windows package is a user-scope NSIS extractor,
    // not an ARP-registered application. Tor documents that the default
    // installation is the user's Desktop\Tor Browser folder and that removal
    // consists of deleting that folder. Model that exact extracted-directory
    // lifecycle instead of waiting for an uninstall registry entry that the
    // vendor intentionally does not create.
    wingetId: 'TorProject.TorBrowser',
    requiredInstallScope: 'user',
    reviewedManagedInstallDirectory: '%USERPROFILE%\\Desktop\\Tor Browser',
  },
  {
    // Speek 1.7.0's reviewed NSIS source installs the complete application to
    // `$PROGRAMFILES\Speek`, writes Speek.exe plus uninstall.exe there, and
    // never creates an Add/Remove Programs entry. NSIS resolves $PROGRAMFILES
    // to Program Files (x86) on 64-bit Windows unless the script explicitly
    // selects the 64-bit view, which Speek does not. Verify and own only that
    // dedicated vendor directory instead of waiting for an ARP identity that
    // the package intentionally omits. Direct managed-directory removal also
    // avoids relying on the vendor uninstaller's incomplete cleanup section.
    wingetId: 'Speek.Speek',
    reviewedManagedInstallDirectory: '%ProgramFiles(x86)%\\Speek',
    reviewedManagedInstallEvidenceFile: '%ProgramFiles(x86)%\\Speek\\Speek.exe',
    reviewedManagedInstallCompletionTimeoutMinutes: 2,
  },
  {
    // darktable's official CPack/NSIS installer writes its ARP registration
    // only after the complete application tree has been extracted. The signed
    // 5.6.0 package can therefore remain quiet longer than the generic QA
    // inactivity window even though /S is the correct vendor contract. A
    // clean 8 GB VM extracted 3,071 files without reaching ARP registration
    // inside ten minutes, so use the reviewed long-installer ceiling. Keep the
    // same installer and ARP lifecycle, while the shared wait makes both QA
    // and customer Intune packages observable and fail closed.
    wingetId: 'darktable.darktable',
    reviewedInstallCompletionTimeoutMinutes: 15,
  },
  {
    // FlashPrint 5.8.3 is distributed as a ZIP containing an Advanced
    // Installer bootstrapper. Its manifest-provided unattended command stays
    // alive without observable file-system activity for longer than the
    // generic QA inactivity window before it completes registration. Keep the
    // vendor command and normal ARP lifecycle, but make the shared packager
    // wait observable and bounded for both QA and customer Intune packages.
    wingetId: 'Flashforge.FlashPrint',
    reviewedInstallCompletionTimeoutMinutes: 15,
  },
  {
    // ZeeDrive's official MSI is a command wrapper that deliberately does not
    // register in Add/Remove Programs. Thinkscape documents COMMAND=Install,
    // versioned Program Files detection, and direct directory removal for its
    // Intune lifecycle. Keep that exact no-ARP contract shared by QA and
    // customer packages instead of attempting to capture dependency ARP noise.
    wingetId: 'Thinkscape.ZeeDrive',
    reviewedInstallArguments: ['COMMAND=Install'],
    reviewedManagedInstallDirectory:
      '%ProgramFiles%\\Thinkscape Zee Drive\\<VERSION>',
    reviewedManagedInstallEvidenceFile:
      '%ProgramFiles%\\Thinkscape Zee Drive\\<VERSION>\\ZeeDrive.exe',
    reviewedManagedInstallCompletionTimeoutMinutes: 5,
  },
  {
    // Analog Devices documents this enterprise/server mode for silent SYSTEM
    // deployment. It prevents the MSI from extracting example data into the
    // LocalSystem AppData profile, which otherwise rolls back with exit 1603.
    wingetId: 'AnalogDevices.LTspice',
    reviewedInstallArguments: ['MY_SPECIAL_MODE=2'],
  },
  {
    // BlueJ 6.0.0 is a dual-purpose WiX MSI. Windows Installer 5 requires
    // ALLUSERS=2 with MSIINSTALLPERUSER=1 to select its per-user registration
    // context; the older ALLUSERS=0 example leaves this package failing under a
    // limited-rights account. Its silent UI also leaves INSTALLDIR rooted below
    // Program Files, so pin that directory to LocalAppData for QA and customers.
    wingetId: 'BlueJTeam.BlueJ',
    requiredInstallScope: 'user',
    reviewedInstallArgumentsOverride:
      '/qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=1 INSTALLDIR="%LOCALAPPDATA%\\Programs\\BlueJ"',
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
    // PTC's bootstrapper forwards MSI properties only when they immediately
    // follow /v. The community manifest's separated `/v /quiet /norestart`
    // command can install the payload but return an error before IntuneGet can
    // verify it and write detection evidence. PTC documents ADDLOCAL="ALL"
    // with /qn for a complete unattended Creo View Express installation.
    wingetId: 'PTC.CreoView.Express',
    reviewedInstallArgumentsOverride: '/vADDLOCAL="ALL" /qn /norestart',
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
    // OpenWebStart documents its Windows payload as an install4j application
    // with a root-level uninstall.exe. The registered command is interactive,
    // and the generic framework detector cannot infer install4j from WinGet's
    // bare `-q` install switch. Append install4j's unattended removal contract
    // to the exact captured product uninstaller for both QA and customers.
    wingetId: 'karakun.OpenWebStart',
    reviewedUninstallArguments: [
      '-q',
      '-Dinstall4j.suppressUnattendedReboot=true',
    ],
  },
  {
    // The official MSYS2 installer always targets C:\msys64 for this WinGet
    // profile and documents its Qt Installer Framework removal command. The
    // catalog name (`MSYS2 Installer`) differs from the registered product
    // (`MSYS2 <version>`), so capture that reviewed identity and use the
    // vendor's headless arguments with the registry-discovered uninstaller for
    // QA and customer packages. Keeping path discovery registry-owned avoids
    // weakening the reviewed exact-path allowlist for root-level executables.
    wingetId: 'MSYS2.MSYS2',
    reviewedUninstallArguments: ['pr', '--confirm-command'],
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
    // Surfshark 6.16 registers the same exact display identity twice: one
    // visible primary MSI and one hidden MSI system component. QA run
    // 32654170672 proved that SystemComponent is the only bounded distinction.
    // Select the single visible entry only after ordinary identity matching;
    // zero or multiple visible matches remain an ambiguity failure.
    wingetId: 'Surfshark.Surfshark',
    reviewedPreferVisiblePrimaryUninstallRegistration: true,
  },
  {
    // TreeSize's dual-mode Inno installer defaults to the invoking account even
    // when the catalog declares machine scope. Under LocalSystem that places the
    // app and its uninstaller below the 32-bit system profile, where silent
    // removal never clears the exact registration. Inno's reviewed /ALLUSERS
    // contract selects administrative install mode and the machine-wide
    // Program Files/HKLM lifecycle required by Intune.
    wingetId: 'JAMSoftware.TreeSize',
    requiredInstallScope: 'machine',
    reviewedInstallArgumentsOverride:
      '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /ALLUSERS',
  },
  {
    // WPS Office is cataloged as a per-user EXE, but the signed installer
    // elevates even with its exact -S switch. A standard-user launch therefore
    // ends at the unattended UAC boundary without creating the registered
    // product. Run that same vendor command in the already-elevated
    // LocalSystem context used by managed Intune deployment.
    wingetId: 'Kingsoft.WPSOffice',
    requiredInstallScope: 'machine',
    reviewedInstallerSelectionScope: 'user',
  },
  {
    // dotPeek registers a versioned JetBrains.Platform.Installer command with
    // /HostsToRemove and /PerMachine, but that command opens the interactive
    // removal path unless JetBrains' documented /Silent=True switch is also
    // present. Append only that vendor-owned mode to the exact captured ARP
    // command and keep the versioned host identity unchanged.
    wingetId: 'JetBrains.dotPeek',
    reviewedUninstallArguments: ['/Silent=True'],
  },
  {
    // JetBrains Toolbox registers its per-user Uninstall.exe without a quiet
    // argument. JetBrains documents /headless as the completely background
    // Windows uninstall mode; append it to the exact captured Toolbox ARP
    // command so Intune removal cannot wait behind an invisible UI.
    wingetId: 'JetBrains.Toolbox',
    reviewedUninstallArguments: ['/headless'],
  },
  {
    // Zen Browser uses Mozilla's NSIS helper.exe lifecycle. Its captured ARP
    // command omits the silent switch and opens the hidden uninstall wizard
    // under SYSTEM, leaving the exact registration present until timeout.
    // Mozilla's enterprise removal contract documents helper.exe /S.
    wingetId: 'Zen-Team.Zen-Browser',
    reviewedUninstallArguments: ['/S'],
  },
  {
    // MEGA's installer source makes silent installs current-user by default.
    // Its reviewed /MULTIUSER option selects the AllUsers path required for
    // non-interactive LocalSystem deployment and machine-wide detection.
    wingetId: 'Mega.MEGASync',
    reviewedInstallArgumentsOverride: '/S /MULTIUSER',
  },
  {
    // Podman Desktop uses Electron Builder's assisted NSIS installer without
    // a per-machine default. A bare /S therefore selects the invoking account,
    // which installs below LocalSystem's profile and leaves an unusable vendor
    // uninstall path. Electron Builder's /allusers contract selects the
    // machine-wide Program Files/HKLM lifecycle required by Intune. Preserve
    // that scope on removal as well for both QA and customer packages.
    wingetId: 'RedHat.Podman-Desktop',
    reviewedInstallArgumentsOverride: '/S /allusers',
    reviewedUninstallArguments: ['/allusers', '/S'],
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
    // Wiris documents MathType 7's unattended removal command as Setup.exe
    // with -Q -R, in that order. The registered command contains only -R, and
    // the generic Nullsoft /S fallback leaves the exact DSMT7 registration
    // installed. Bind the official Program Files (x86) command to QA and
    // customer packages while retaining DSMT7 as authoritative evidence.
    wingetId: 'Wiris.MathType.7',
    reviewedExactUninstall: {
      executablePath: '%ProgramFiles(x86)%\\MathType\\Setup.exe',
      arguments: ['-Q', '-R'],
      completionTimeoutMinutes: 5,
    },
  },
  {
    // MiKTeX registers its Console cleanup page as the ARP uninstall command.
    // That command opens an interactive Qt workflow and leaves the exact
    // registration installed under non-interactive LocalSystem. MiKTeX's
    // integrated setup utility is the documented unattended removal path;
    // --shared=yes is required for the all-users installation selected here.
    wingetId: 'MiKTeX.MiKTeX',
    reviewedExactUninstall: {
      executablePath:
        '%ProgramFiles%\\MiKTeX\\miktex\\bin\\x64\\miktexsetup.exe',
      arguments: ['--quiet', '--shared=yes', 'uninstall'],
      completionTimeoutMinutes: 15,
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
    // Bria keeps its desktop client running in the notification area when its
    // window is closed. The MSI uninstall can then return 1603 and leave the
    // exact product registration installed. CounterPath's removal guidance
    // requires Bria to be exited first, so close only the reviewed Bria client
    // through PSADT before install, upgrade, or uninstall.
    wingetId: 'Bria.Bria',
    requiredProcessesToClose: [
      { name: 'Bria', description: 'Bria' },
    ],
  },
  {
    // Microsoft's Azure Monitor Agent client guidance says to stop the agent
    // service before retrying an uninstall that cannot stop it. The signed MSI
    // otherwise returns 1601 and leaves its exact product registration behind.
    wingetId: 'Microsoft.AzureMonitorAgent',
    reviewedUninstallServiceNames: ['AzureMonitorAgent'],
  },
  {
    // Logi Bolt's dedicated uninstaller is not a conventional NSIS helper:
    // the generic /S fallback returns while leaving the exact LogiBolt ARP
    // registration installed. Its unattended removal verb is /silent. Bind
    // that switch to the exact machine-wide helper captured by QA so hidden
    // SYSTEM sessions never wait behind Logitech's confirmation dialog.
    wingetId: 'Logitech.LogiBolt',
    reviewedExactUninstall: {
      executablePath: '%ProgramFiles%\\Logi\\LogiBolt\\LogiBoltUninstaller.exe',
      arguments: ['/silent'],
      completionTimeoutMinutes: 5,
    },
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
    // Logitech publishes Presentation as a user-scope NSIS package, but the
    // signed bootstrapper requests elevation even when /S is supplied. A
    // standard Intune user therefore receives an unserviceable UAC credential
    // prompt. Logitech documents the same binary for remote deployment with
    // /S plus the update and analytics controls below. Select the published
    // user-scoped binary while executing the managed package as LocalSystem.
    wingetId: 'Logitech.Presentation',
    requiredInstallScope: 'machine',
    reviewedInstallerSelectionScope: 'user',
    reviewedInstallArgumentsOverride: '/S /U:0 /A:0',
  },
  {
    // WinGet publishes NVM for Windows as a user-scope Inno package whose own
    // setup source requires administrative privileges and writes machine-wide
    // environment values. A standard Intune user cannot satisfy the vendor's
    // self-elevation prompt. Keep selecting the trusted user-scoped bytes, but
    // execute the managed package as LocalSystem and place the payload in a
    // deterministic machine directory instead of the SYSTEM profile.
    wingetId: 'CoreyButler.NVMforWindows',
    requiredInstallScope: 'machine',
    reviewedInstallerSelectionScope: 'user',
    reviewedInstallArgumentsOverride:
      '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="%ProgramFiles%\\nvm"',
  },
  {
    // G HUB's evergreen bootstrapper can spend several minutes installing
    // child packages after its silent launcher starts. Keep PSADT alive and
    // observable for that reviewed window instead of treating the quiet
    // bootstrapper as stalled. Logitech's registered software-manager command
    // is interactive and does not remove the product under LocalSystem; close
    // the documented G HUB process family and invoke the installed updater's
    // full unattended removal contract while retaining the exact ARP identity
    // as the authoritative completion signal.
    wingetId: 'Logitech.GHUB',
    requiredProcessesToClose: [
      { name: 'lghub', description: 'Logitech G HUB' },
      { name: 'lghub_agent', description: 'Logitech G HUB Agent' },
      { name: 'lghub_updater', description: 'Logitech G HUB Updater' },
      { name: 'lghub_software_manager', description: 'Logitech G HUB Software Manager' },
    ],
    reviewedInstallCompletionTimeoutMinutes: 15,
    reviewedExactUninstall: {
      executablePath: '%ProgramFiles%\\LGHUB\\lghub_updater.exe',
      arguments: ['--uninstall', '--full'],
      completionTimeoutMinutes: 10,
    },
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
    // DesktopOK publishes both user- and machine-scope installers. Intune runs
    // Win32 packages as SYSTEM, and the reviewed exact uninstaller lives below
    // Program Files, so keep package creation on the machine-scope variant.
    // Reuse the vendor's documented /silent mode ahead of the registered
    // -?uninstall verb so removal never waits for interactive UI.
    wingetId: 'SoftwareOK.DesktopOK',
    requiredInstallScope: 'machine',
    reviewedExactUninstall: {
      executablePath: '%ProgramFiles%\\DesktopOK\\DesktopOK_x64.exe',
      arguments: ['/silent', '-?uninstall'],
      completionTimeoutMinutes: 5,
    },
  },
  {
    wingetId: 'SoftwareOK.Q-Dir',
    reviewedUninstallArguments: ['/silent', 'forall'],
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
    // Autodesk documents Desktop Licensing Service as a shared component that
    // does not appear in Programs and Features. Verify its dedicated payload
    // instead of trying to select one of the unrelated Autodesk ARP changes,
    // and use the vendor's documented unattended uninstaller during removal.
    wingetId: 'Autodesk.LicensingService',
    reviewedManagedInstallDirectory:
      '%ProgramFiles(x86)%\\Common Files\\Autodesk Shared\\AdskLicensing',
    reviewedManagedInstallEvidenceFile:
      '%ProgramFiles(x86)%\\Common Files\\Autodesk Shared\\AdskLicensing\\uninstall.exe',
    reviewedManagedInstallCompletionTimeoutMinutes: 5,
    reviewedManagedUninstall: {
      executablePath:
        '%ProgramFiles(x86)%\\Common Files\\Autodesk Shared\\AdskLicensing\\uninstall.exe',
      arguments: ['--mode', 'unattended'],
      completionTimeoutMinutes: 5,
    },
  },
  {
    // Design Review is delivered by Autodesk ODIS. Its SFX bootstrapper exits
    // before ODIS finishes registering the product, so generic ARP capture can
    // race the background install. Wait for the reviewed product evidence and
    // ODIS completion, then use the exact manifest lifecycle observed from the
    // vendor registration and installer URL.
    wingetId: 'Autodesk.DesignReview',
    reviewedManagedInstallDirectory:
      '%ProgramW6432%\\Autodesk\\Autodesk Design Review',
    reviewedManagedInstallEvidenceFile:
      '%ProgramW6432%\\Autodesk\\Autodesk Design Review\\DesignReview.exe',
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
        '%ProgramData%\\Autodesk\\ODIS\\metadata\\{C1AF4762-AE0A-3B4E-836B-D4C091BF46F8}\\bundleManifest.xml',
        '-x',
        '%ProgramData%\\Autodesk\\ODIS\\metadata\\{C1AF4762-AE0A-3B4E-836B-D4C091BF46F8}\\SetupRes\\manifest.xsd',
      ],
      completionTimeoutMinutes: 15,
    },
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
    // Microsoft's FSLogix bundle documents /norestart for suppressing every
    // restart attempt. The registered Burn uninstall command contains only
    // /uninstall /quiet; production QA run 32622117211 confirmed that exact
    // command powered off the isolated endpoint before the lifecycle report
    // could be written. Append the vendor-supported restart suppression to the
    // exact captured command for both customer Intune removal and QA.
    wingetId: 'Microsoft.FSLogix',
    reviewedUninstallArguments: ['/norestart'],
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
    // The RMS client uses a Burn bootstrapper whose uninstall parent exits
    // before the bundle registration is removed. The default five-minute
    // registry-aware completion window can expire even though the vendor child
    // process finishes successfully shortly afterward. Keep the exact
    // registration check authoritative, but allow this reviewed lifecycle the
    // bounded time it needs in both QA and customer deployments.
    wingetId: 'Microsoft.RMSClient',
    uninstallCompletionTimeoutMinutes: 10,
  },
  {
    // Movavi Photo Focus 1.1.0's signed NSIS installer returns the Windows
    // ERROR_CANCELLED code (1223) after it has successfully created the exact
    // product ARP registration. The shared packager still requires that
    // post-install registry identity before it writes detection evidence, so
    // a genuine cancellation without an installed product continues to fail.
    wingetId: 'Movavi.MovaviPhotoFocus',
    reviewedInstallerSuccessCodes: [1223],
  },
  {
    // Windows App Runtime is a shared MSIX framework. Microsoft's package
    // identity is Microsoft.WindowsAppRuntime.1.8, and the 1.8.9 installer
    // deploys framework version 8000.879.2017.0 under Microsoft's publisher.
    // Verify that exact Appx identity and retain it when Intune relinquishes
    // ownership; ARP activity from WebView2 or other servicing is unrelated.
    wingetId: 'Microsoft.WindowsAppRuntime.1.8',
    preserveVendorInstallationOnUninstall: true,
    reviewedAppxInstallEvidence: {
      packageName: 'Microsoft.WindowsAppRuntime.1.8',
      publisherId: '8wekyb3d8bbwe',
      minimumVersion: '8000.879.2017.0',
    },
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
      // A Build Tools bootstrapper without an explicit workload only installs
      // or updates the shared Visual Studio Installer and leaves no product
      // instance to detect or manage. Microsoft's unattended examples require
      // a deterministic --installPath together with --add; MSBuildTools is the
      // smallest useful, generation-stable workload. Keep install, evidence,
      // and uninstall pinned to the same reviewed instance path.
      reviewedInstallArguments: wingetId.endsWith('.BuildTools')
        ? [
            `--installPath "${installPath}"`,
            '--add Microsoft.VisualStudio.Workload.MSBuildTools',
            '--norestart',
          ]
        : undefined,
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
    // Preview builds use the same executable and Inno AppId as stable builds.
    // Close the tray process before the exact vendor uninstaller runs.
    wingetId: 'Greenshot.Greenshot.Preview',
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
  {
    // SketchUp Pro 2022 registers its cached InstallShield wrapper with
    // -remove -runfromtemp, but that command remains interactive and left the
    // exact {C631706C-...} registration after the bounded QA deadline. The
    // vendor-family wrapper supports -silent on removal; append only that
    // missing argument to the exact captured command.
    wingetId: 'Trimble.SketchUp.2022',
    reviewedUninstallArguments: ['-silent'],
  },
  {
    // NeoLoad registers its install4j uninstaller without an unattended
    // argument. install4j documents -q for both installers and uninstallers;
    // append it to the exact captured registration instead of guessing a
    // product path or replacing the vendor command.
    wingetId: 'Tricentis.NeoLoad',
    reviewedUninstallArguments: ['-q'],
  },
  {
    // Postgres Pro's Windows installer is built from the vendor's PostgreSQL
    // NSIS source and registers an ordinary `PostgreSQL <major> (64bit)` ARP
    // entry. Its generated uninstaller accepts NSIS /S; append that reviewed
    // switch to the exact captured command for unattended Intune removal.
    wingetId: 'PostgresPro.Standard.17',
    reviewedUninstallArguments: ['/S'],
  },
  {
    // Webroot publishes both an MSI and a machine-scoped EXE. The EXE's
    // registered WRUNINST removal route is interactive, while the MSI has the
    // standard unattended Windows Installer lifecycle required by Intune.
    // Never fall back to the EXE if the reviewed MSI entry disappears. The
    // MSI's MainWSAInstall custom action can remain quiet beyond the generic
    // QA inactivity window. The exact 9.0.45.63 MSI exposes Webroot's documented
    // CMDLINE property but defaults it to -null. Production QA run 32617479599
    // showed that default still owning the global MSI mutex at the reviewed
    // 30-minute ceiling. Select Webroot's documented SME quiet mode while
    // retaining the observable, fail-closed bound for customer Intune execution
    // and QA alike.
    wingetId: 'Webroot.SecureAnywhere',
    reviewedInstallerSelectionType: 'msi',
    reviewedInstallArguments: ['CMDLINE=SME,quiet'],
    reviewedInstallCompletionTimeoutMinutes: 30,
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

function normalizeInstallerSuccessCodes(
  successCodes: readonly number[] | undefined
): number[] {
  return Array.from(new Set((successCodes || [])
    .map(Number)
    .filter((code) => Number.isInteger(code) && code >= -2147483648 && code <= 4294967295)
    .map((code) => code > 2147483647 ? code - 4294967296 : code)))
    .sort((left, right) => left - right);
}

/**
 * Add reviewed vendor exit codes at the final shared packaging boundary.
 * These codes never replace post-install evidence: the generated PSADT package
 * must still capture the application's exact installation identity.
 */
export function resolveApplicationInstallerSuccessCodes(
  wingetId: string,
  successCodes: readonly number[] | undefined
): number[] {
  const adapter = applicationPackagingAdapter(wingetId);
  return normalizeInstallerSuccessCodes([
    ...(successCodes || []),
    ...(adapter?.reviewedInstallerSuccessCodes || []),
  ]);
}

/**
 * Return whether a reviewed application adapter supplies the install-side
 * contract that an opaque EXE manifest does not. Uninstall-only and
 * verification-only adapters deliberately do not qualify.
 */
export function hasReviewedApplicationInstallContract(wingetId: string): boolean {
  const adapter = applicationPackagingAdapter(wingetId);
  return Boolean(
    adapter && (
      adapter.reviewedInstallArguments?.some((argument) => argument.trim()) ||
      adapter.reviewedInstallArgumentsOverride?.trim() ||
      adapter.reviewedArgumentlessInstall ||
      adapter.reviewedInstallCompletionTimeoutMinutes ||
      adapter.reviewedInstallShieldAdministrativeImage
    )
  );
}

export function resolveApplicationInstallScope(
  wingetId: string,
  requestedScope?: string | null
): WingetScope {
  const requested = requestedScope?.trim().toLowerCase() === 'user' ? 'user' : 'machine';
  return applicationPackagingAdapter(wingetId)?.requiredInstallScope || requested;
}

/**
 * Return the manifest scope used to select the trusted installer bytes. This
 * normally matches the managed execution scope. A reviewed adapter may select
 * a vendor-published user entry while still requiring LocalSystem execution;
 * that exception is app-specific and cannot be supplied by customer input.
 */
export function resolveApplicationInstallerSelectionScope(
  wingetId: string,
  executionScope: WingetScope
): WingetScope {
  return applicationPackagingAdapter(wingetId)?.reviewedInstallerSelectionScope ||
    executionScope;
}

/**
 * Return an app-specific trusted manifest installer type. A reviewed type is a
 * strict lifecycle requirement: callers must fail closed rather than fall back
 * to a different wrapper when the requested type is absent.
 */
export function resolveApplicationInstallerSelectionType(
  wingetId: string
): WingetInstallerType | undefined {
  return applicationPackagingAdapter(wingetId)?.reviewedInstallerSelectionType;
}

const REVIEWED_REGISTRY_UNINSTALL_IDENTITIES: Readonly<Record<string, Readonly<{
  generatedDisplayName: string;
  manifestRegistryKey?: string;
  registeredDisplayName: string;
  registeredRegistryKey?: string;
}>>> = {
  // RobotStudio's InstallShield wrapper updates Edge during installation. The
  // exact 2025.2 MSI identity prevents that unrelated servicing delta from
  // being captured as RobotStudio's uninstall command.
  'abb.robotstudio': {
    generatedDisplayName: 'RobotStudio',
    registeredDisplayName: 'ABB RobotStudio 2025.2',
    registeredRegistryKey: '{F8E387C8-8D36-4513-A1AB-9C438461D926}',
  },
  // The EXE package's catalog name distinguishes it from Google.Chrome, but
  // Google's machine installer registers the ordinary `Google Chrome` ARP
  // identity. Keep that exact vendor identity for capture, verification, and
  // Intune removal instead of weakening the generic one-product matcher.
  'google.chrome.exe': {
    generatedDisplayName: 'Google Chrome (EXE)',
    registeredDisplayName: 'Google Chrome',
  },
  // Chromium's own install-mode contract registers the Beta channel below the
  // `Google Chrome Beta` uninstall key with the same long display name. WinGet's
  // EXE manifest currently combines the stable-channel `Google Chrome` key with
  // the catalog-only `Google Chrome Beta (EXE)` label. Bind the vendor's exact
  // channel identity so Google Updater ARP changes cannot make capture ambiguous.
  'google.chrome.beta.exe': {
    generatedDisplayName: 'Google Chrome Beta (EXE)',
    manifestRegistryKey: 'Google Chrome',
    registeredDisplayName: 'Google Chrome Beta',
    registeredRegistryKey: 'Google Chrome Beta',
  },
  // The legacy Edge-channel package is still named `Docker Desktop Edge` in
  // the catalog, but Docker registers the installed product as the ordinary
  // `Docker Desktop` ARP entry. Use that exact vendor identity so install
  // capture, Intune detection, and unattended removal all address the same
  // product without broadening the generic registry matcher.
  'docker.dockerdesktopedge': {
    generatedDisplayName: 'Docker Desktop Edge',
    registeredDisplayName: 'Docker Desktop',
  },
  // Greenshot's preview catalog title is `Greenshot Preview`, while the
  // vendor's Inno source keeps AppId and AppName fixed at `Greenshot` for both
  // channels. Bind the stable `_is1` key so background ARP changes cannot be
  // selected and stable/preview packages never rely on broad name matching.
  'greenshot.greenshot.preview': {
    generatedDisplayName: 'Greenshot Preview',
    registeredDisplayName: 'Greenshot',
    registeredRegistryKey: 'Greenshot_is1',
  },
  // FSLogix is distributed as a ZIP containing Microsoft's Burn-style EXE.
  // WinGet publishes `Microsoft FSLogix Apps` in ProductCode, but the bundle
  // creates a generated GUID ARP key with that value as its DisplayName. Bind
  // the reviewed display identity so prerequisite ARP changes cannot prevent
  // install capture and the same exact vendor entry drives customer removal.
  // The application adapter also appends Microsoft's documented /norestart so
  // that removal cannot unexpectedly restart the managed endpoint.
  'microsoft.fslogix': {
    generatedDisplayName: 'FSLogix',
    registeredDisplayName: 'Microsoft FSLogix Apps',
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
  // Creo View Express installs several prerequisite products, and its ARP
  // display name carries the embedded product release rather than WinGet's
  // package version. WinGet publishes the main MSI ProductCode, so bind that
  // immutable identity instead of selecting from multiple changed entries.
  'ptc.creoview.express': {
    generatedDisplayName: 'PTC Creo View Express',
    registeredDisplayName: 'PTC Creo View Express',
    registeredRegistryKey: '{6DE7DB1D-27F7-46A8-AE3A-D8C2BB62870B}',
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
  // Postgres Pro's official Windows build scripts keep PRODUCT_NAME set to
  // PostgreSQL and derive the x64 ARP branding as `PostgreSQL <major>
  // (64bit)`. Bind that exact stable NSIS key so prerequisite registry deltas
  // cannot win capture and the same identity drives customer detection and
  // removal.
  'postgrespro.standard.17': {
    generatedDisplayName: 'Postgres Pro Standard 17',
    registeredDisplayName: 'PostgreSQL 17 (64bit)',
    registeredRegistryKey: 'PostgreSQL 17 (64bit)',
  },
  'msys2.msys2': {
    generatedDisplayName: 'MSYS2 Installer',
    registeredDisplayName: 'MSYS2',
  },
};

export function resolveApplicationUninstallCommand(
  wingetId: string,
  uninstallCommand: string
): string {
  const reviewed = REVIEWED_REGISTRY_UNINSTALL_IDENTITIES[wingetId.trim().toLowerCase()];
  if (!reviewed) return uninstallCommand;
  const expected = `REGISTRY_UNINSTALL:${reviewed.generatedDisplayName}`;
  const expectedManifestKey = reviewed.manifestRegistryKey
    ? `REGISTRY_UNINSTALL_KEY:${reviewed.manifestRegistryKey}:${reviewed.generatedDisplayName}`
    : undefined;
  const normalizedUninstallCommand = uninstallCommand.trim();
  if (
    normalizedUninstallCommand !== expected &&
    normalizedUninstallCommand !== expectedManifestKey
  ) return uninstallCommand;
  if (!reviewed.registeredRegistryKey) {
    return `REGISTRY_UNINSTALL:${reviewed.registeredDisplayName}`;
  }
  const reviewedKey = reviewed.registeredRegistryKey;
  const isMsiProductCode = /^\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}$/.test(
    reviewedKey
  );
  return `${isMsiProductCode ? 'REGISTRY_UNINSTALL_PRODUCT' : 'REGISTRY_UNINSTALL_KEY'}:${reviewedKey}:${reviewed.registeredDisplayName}`;
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
      !config.reviewedPreferVisiblePrimaryUninstallRegistration &&
      !config.reviewedInstallArgumentsOverride &&
      !config.reviewedArgumentlessInstall &&
      !config.reviewedInstallCompletionTimeoutMinutes &&
      !config.reviewedInstallShieldAdministrativeImage &&
      !config.reviewedMultiProductInstallDisplayNamePrefixes &&
      !config.reviewedMultiProductInstallMinimumCount &&
      !config.reviewedRegistryInstallEvidence &&
      !config.reviewedAppxInstallEvidence &&
      !config.reviewedUninstallProcessGuard &&
      !config.reviewedUninstallServiceNames &&
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
      reviewedPreferVisiblePrimaryUninstallRegistration: undefined,
      reviewedInstallArgumentsOverride: undefined,
      reviewedArgumentlessInstall: undefined,
      reviewedInstallCompletionTimeoutMinutes: undefined,
      reviewedInstallShieldAdministrativeImage: undefined,
      reviewedMultiProductInstallDisplayNamePrefixes: undefined,
      reviewedMultiProductInstallMinimumCount: undefined,
      reviewedRegistryInstallEvidence: undefined,
      reviewedAppxInstallEvidence: undefined,
      reviewedUninstallProcessGuard: undefined,
      reviewedUninstallServiceNames: undefined,
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
    reviewedArgumentlessInstall: adapter.reviewedArgumentlessInstall || undefined,
    reviewedInstallCompletionTimeoutMinutes:
      adapter.reviewedInstallCompletionTimeoutMinutes,
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
    reviewedUninstallServiceNames: adapter.reviewedUninstallServiceNames
      ? [...adapter.reviewedUninstallServiceNames]
      : undefined,
    ...(adapter.uninstallCompletionTimeoutMinutes
      ? { uninstallCompletionTimeoutMinutes: adapter.uninstallCompletionTimeoutMinutes }
      : {}),
    preserveVendorInstallationOnUninstall:
      adapter.preserveVendorInstallationOnUninstall || undefined,
    reviewedPreferVisiblePrimaryUninstallRegistration:
      adapter.reviewedPreferVisiblePrimaryUninstallRegistration || undefined,
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
    reviewedAppxInstallEvidence: adapter.reviewedAppxInstallEvidence
      ? { ...adapter.reviewedAppxInstallEvidence }
      : undefined,
  };
}
