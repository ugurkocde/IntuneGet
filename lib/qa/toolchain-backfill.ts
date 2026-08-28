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
const EMPTY_ARGUMENT_PREDECESSOR_RETRY_TARGETS = [
    // Retry Preview with the vendor's exact Greenshot_is1 Inno identity.
    'Greenshot.Greenshot.Preview',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'ABB.RobotStudio',
    'Microsoft.msodbcsql.13',
    'Microsoft.WindowsAppRuntime.1.8',
    'AppiumDevelopers.AppiumInspector',
    'Autodesk.DesignReview',
    'BlueJTeam.BlueJ',
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ] as const;

const ELEGANT_CLIPBOARD_RELEASE_RETRY_TARGETS = [
  // Retry ElegantClipboard in the publisher-declared current-user context.
  'Y-ASLant.ElegantClipboard',
  // Carry every still-unconsumed bounded target across the atomic pin.
  'Amazon.Music',
  ...EMPTY_ARGUMENT_PREDECESSOR_RETRY_TARGETS,
] as const;

const MIKTEX_RELEASE_RETRY_TARGETS = [
  // Retry MiKTeX with its documented integrated unattended setup utility.
  'MiKTeX.MiKTeX',
  // Carry every still-unconsumed bounded target across the atomic pin.
  ...ELEGANT_CLIPBOARD_RELEASE_RETRY_TARGETS,
] as const;

const FSLOGIX_RELEASE_RETRY_TARGETS = [
  // Retry FSLogix with Microsoft's documented restart suppression after its
  // registered /uninstall /quiet command powered off the isolated endpoint.
  'Microsoft.FSLogix',
  // Carry every still-unconsumed bounded target across the atomic pin. Exclude
  // the existing FSLogix carry-forward entry to keep the dispatch list unique.
  'Tricentis.NeoLoad',
  'Piriform.Recuva',
  'Trimble.SketchUp.2022',
  ...MIKTEX_RELEASE_RETRY_TARGETS.filter(
    (wingetId) => wingetId !== 'Microsoft.FSLogix'
  ),
] as const;

const CHROME_BETA_REGISTRY_RELEASE_RETRY_TARGETS = [
  // Retry Chrome Beta EXE with Chromium's exact channel-specific ARP key after
  // the stale WinGet stable-channel identity made capture ambiguous.
  'Google.Chrome.Beta.EXE',
  // Carry every still-unconsumed bounded target across the atomic pin.
  ...FSLOGIX_RELEASE_RETRY_TARGETS,
] as const;

const VISUAL_STUDIO_BUILD_TOOLS_RELEASE_RETRY_TARGETS = [
  // Retry every supported Build Tools generation with a minimal explicit
  // workload so the bootstrapper creates a detectable product instance.
  'Microsoft.VisualStudio.BuildTools',
  'Microsoft.VisualStudio.2017.BuildTools',
  'Microsoft.VisualStudio.2019.BuildTools',
  'Microsoft.VisualStudio.2022.BuildTools',
  // Carry every still-unconsumed bounded target across the atomic pin while
  // excluding Build Tools entries already declared above.
  ...CHROME_BETA_REGISTRY_RELEASE_RETRY_TARGETS.filter(
    (wingetId) => !wingetId.toLowerCase().endsWith('.buildtools')
  ),
] as const;

const VISUAL_STUDIO_BUILD_TOOLS_INSTALL_PATH_RELEASE_RETRY_TARGETS = [
  // Retry every supported Build Tools generation with an explicit instance
  // path so install, evidence, and vendor uninstall address the same product.
  'Microsoft.VisualStudio.BuildTools',
  'Microsoft.VisualStudio.2017.BuildTools',
  'Microsoft.VisualStudio.2019.BuildTools',
  'Microsoft.VisualStudio.2022.BuildTools',
  // Carry every still-unconsumed bounded target across the atomic pin while
  // excluding Build Tools entries already declared above.
  ...VISUAL_STUDIO_BUILD_TOOLS_RELEASE_RETRY_TARGETS.filter(
    (wingetId) => !wingetId.toLowerCase().endsWith('.buildtools')
  ),
] as const;

const AMBIGUOUS_UNINSTALL_DIAGNOSTICS_RELEASE_RETRY_TARGETS = [
  // Capture the two exact Surfshark ARP identities before defining a reviewed
  // selector. The shared packager remains fail-closed and logs bounded fields.
  'Surfshark.Surfshark',
  // Carry every still-unconsumed bounded target across the atomic pin.
  ...VISUAL_STUDIO_BUILD_TOOLS_INSTALL_PATH_RELEASE_RETRY_TARGETS,
] as const;

const SURFSHARK_VISIBLE_PRIMARY_RELEASE_RETRY_TARGETS = [
  // Re-run the exact failed Surfshark release with the reviewed selector that
  // distinguishes its visible primary MSI from the hidden system component.
  // Carry all still-unconsumed bounded targets across the atomic pin.
  ...AMBIGUOUS_UNINSTALL_DIAGNOSTICS_RELEASE_RETRY_TARGETS,
] as const;

const LEAF_ONLY_UNINSTALL_PATH_RELEASE_RETRY_TARGETS = [
  // Re-run Surfshark after allowing its exact leaf-only msiexec.exe command to
  // reach the existing product-code parser. Carry every bounded target forward.
  ...SURFSHARK_VISIBLE_PRIMARY_RELEASE_RETRY_TARGETS,
] as const;

const ATLASSIAN_QUIET_UNINSTALL_RELEASE_RETRY_TARGETS = [
  // Re-run Jira Service Management with Atlassian's documented unattended
  // uninstaller argument, then carry every still-unconsumed bounded target.
  'Atlassian.ServiceManagementLTS',
  ...LEAF_ONLY_UNINSTALL_PATH_RELEASE_RETRY_TARGETS,
] as const;

const REDISINSIGHT_USER_SCOPE_RELEASE_RETRY_TARGETS = [
  // RedisInsight's NSIS installer is explicitly per-user. Re-run the failed
  // release in user context, then carry every still-unconsumed bounded target.
  'RedisInsight.RedisInsight',
  ...ATLASSIAN_QUIET_UNINSTALL_RELEASE_RETRY_TARGETS,
] as const;

const DESKTOPOK_BLOCK_RELEASE_RETRY_TARGETS =
  REDISINSIGHT_USER_SCOPE_RELEASE_RETRY_TARGETS.filter(
    (wingetId) => wingetId.toLowerCase() !== 'softwareok.desktopok'
  );

const SPEEK_BLOCK_RELEASE_RETRY_TARGETS =
  DESKTOPOK_BLOCK_RELEASE_RETRY_TARGETS.filter(
    (wingetId) => wingetId.toLowerCase() !== 'speek.speek'
  );

const WATERFOX_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS = [
  // Re-run the exact failed Waterfox release with Mozilla's unattended /S
  // helper contract, then carry every still-unconsumed bounded target.
  'Waterfox.Waterfox',
  ...SPEEK_BLOCK_RELEASE_RETRY_TARGETS,
] as const;

const PLAYNITE_PROCESS_CLOSE_RELEASE_RETRY_TARGETS = [
  // Re-run Playnite with both vendor-published desktop frontends closed before
  // its exact Inno removal, then carry every still-unconsumed bounded target.
  'Playnite.Playnite',
  ...WATERFOX_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS,
] as const;

const IDM_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS = [
  // Re-run the exact failed IDM release with its unattended /S uninstall
  // switch, then carry every still-unconsumed bounded target.
  'Tonec.InternetDownloadManager',
  ...PLAYNITE_PROCESS_CLOSE_RELEASE_RETRY_TARGETS,
] as const;

const IDM_WINDOW_AUTOMATION_RELEASE_RETRY_TARGETS = [
  // Replace IDM's ineffective /S attempt with the reviewed, exact-process
  // window sequence, then carry every still-unconsumed bounded target.
  ...IDM_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS,
] as const;

const IOBIT_INNO_UNINSTALL_RELEASE_RETRY_TARGETS = [
  // Re-run the exact failed IObit release with Inno Setup's documented silent
  // removal contract, then carry every still-unconsumed bounded target.
  'IObit.Uninstaller',
  ...IDM_WINDOW_AUTOMATION_RELEASE_RETRY_TARGETS,
] as const;

const IOBIT_DETAIN_UNINSTALL_RELEASE_RETRY_TARGETS = [
  // Replace IObit's ineffective standard-only Inno attempt with the reviewed
  // vendor-specific detain switch, then carry every unconsumed bounded target.
  ...IOBIT_INNO_UNINSTALL_RELEASE_RETRY_TARGETS,
] as const;

const AUTODESK_DESKTOP_CONNECTOR_ODIS_RELEASE_RETRY_TARGETS = [
  // Re-run Desktop Connector with a bounded wait for its detached ODIS product
  // registration, then carry every still-unconsumed targeted retry.
  'Autodesk.DesktopConnector',
  ...IOBIT_DETAIN_UNINSTALL_RELEASE_RETRY_TARGETS,
] as const;

const EGNYTE_UPDATE_ON_BOOT_RELEASE_RETRY_TARGETS = [
  // Re-run Egnyte with the vendor-required update-on-boot property when the
  // managed package suppresses reboot, then carry every unconsumed retry.
  'Egnyte.EgnyteDesktopApp',
  ...AUTODESK_DESKTOP_CONNECTOR_ODIS_RELEASE_RETRY_TARGETS,
] as const;

const STREAM_DECK_EXISTING_HELPER_RELEASE_RETRY_TARGETS = [
  // Re-run Stream Deck after extending only its exact helper guard to include
  // a bounded pre-uninstall creation window.
  'Elgato.StreamDeck',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...EGNYTE_UPDATE_ON_BOOT_RELEASE_RETRY_TARGETS,
] as const;

const WINDOWS_APP_RUNTIME_13_RELEASE_RETRY_TARGETS = [
  // Retry the exact failed 1.3.3 installer with Microsoft's observed shared
  // Appx framework identity instead of requiring a nonexistent ARP entry.
  'Microsoft.WindowsAppRuntime.1.3',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...EGNYTE_UPDATE_ON_BOOT_RELEASE_RETRY_TARGETS,
] as const;

const TOTAL_COMMANDER_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS = [
  // Retry the exact failed 11.58 lifecycle with Ghisler's documented /7
  // unattended mode appended to the captured Total Commander uninstaller.
  'Ghisler.TotalCommander',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...WINDOWS_APP_RUNTIME_13_RELEASE_RETRY_TARGETS,
] as const;

const POLY_LENS_RENAMED_IDENTITY_RELEASE_RETRY_TARGETS = [
  // Retry the failed 5.1 transitional MSI using HP's renamed Poly Studio ARP
  // identity while retaining exact observed-key capture and removal.
  'Poly.PolyLens',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...TOTAL_COMMANDER_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS,
] as const;

const JAMOVI_REGISTERED_IDENTITY_RELEASE_RETRY_TARGETS = [
  // Retry the failed 2.7.18 lifecycle against the exact lowercase jamovi ARP
  // identity while leaving the installer's Visual C++ registrations untouched.
  'Jamovi.Desktop.Current',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...POLY_LENS_RENAMED_IDENTITY_RELEASE_RETRY_TARGETS,
] as const;

const IRFANVIEW_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS = [
  // Retry the failed 4.75 lifecycle with IrfanView's documented case-sensitive
  // /silent switch appended to the exact captured iv_uninstall.exe command.
  'IrfanSkiljan.IrfanView',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...JAMOVI_REGISTERED_IDENTITY_RELEASE_RETRY_TARGETS,
] as const;

const LOGITECH_LGS_SYSTEM_EXECUTION_RELEASE_RETRY_TARGETS = [
  // Retry the failed 9.04.49 lifecycle while selecting the same trusted
  // user-scoped catalog bytes and executing their /S contract as LocalSystem.
  'Logitech.LGS',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...IRFANVIEW_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS,
] as const;

const ANDROID_APPS_MANAGER_USER_SCOPE_RELEASE_RETRY_TARGETS = [
  // Retry the failed 0.1.0 lifecycle in the Tauri NSIS installer's intended
  // signed-in user context instead of LocalSystem's systemprofile.
  'SIMSDEV.AndroidAppsManager',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...LOGITECH_LGS_SYSTEM_EXECUTION_RELEASE_RETRY_TARGETS,
] as const;

const WOWUP_BETA_USER_SCOPE_RELEASE_RETRY_TARGETS = [
  // Retry the failed 2.21.0-beta.6 lifecycle in the NSIS installer's intended
  // signed-in user context instead of LocalSystem's systemprofile.
  'WowUp.Wowup.Beta',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...ANDROID_APPS_MANAGER_USER_SCOPE_RELEASE_RETRY_TARGETS,
] as const;

const SWITCHBAR_USER_SCOPE_RELEASE_RETRY_TARGETS = [
  // Retry the failed 32.6.0 lifecycle in the NSIS installer's intended
  // signed-in user context instead of LocalSystem's systemprofile.
  'WebCatalogLtd.Switchbar',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...WOWUP_BETA_USER_SCOPE_RELEASE_RETRY_TARGETS,
] as const;

const SKETCHUPVIEWER_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS = [
  // Retry the failed Viewer 2022 lifecycle with the same reviewed -silent
  // InstallShield removal mode already proven by SketchUp Pro 2022.
  'Trimble.SketchUpViewer',
  // Activate the two earlier catalog-scoped fixes that were intentionally held
  // behind the prior immutable packager pin.
  'SeqLens.SeqLens',
  'Segger.EmbeddedStudioARM',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...SWITCHBAR_USER_SCOPE_RELEASE_RETRY_TARGETS,
] as const;

const QDIR_UNSUPPORTED_UNINSTALL_RELEASE_RETRY_TARGETS = [
  // Q-Dir is eligibility-blocked after two isolated runs disproved its exact
  // registered removal command. Carry the remaining bounded retries without
  // replaying the unsupported lifecycle.
  ...SKETCHUPVIEWER_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS,
] as const;

const SEAMEET_USER_SCOPE_RELEASE_RETRY_TARGETS = [
  // Retry the failed 3.6.2 lifecycle in the NSIS installer's intended signed-in
  // user context instead of LocalSystem's disposable systemprofile.
  'SeasaltAI.SeaMeetSnapRecorder',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...QDIR_UNSUPPORTED_UNINSTALL_RELEASE_RETRY_TARGETS,
] as const;

const BRITYMEETING_USER_SCOPE_RELEASE_RETRY_TARGETS = [
  // Retry the failed 2.7.26.07281 lifecycle with the same vendor -s command in
  // the desktop client's intended signed-in user context.
  'SamsungSDS.BrityMeeting',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...SEAMEET_USER_SCOPE_RELEASE_RETRY_TARGETS,
] as const;

const REBOOT_REQUIRED_UNINSTALL_RELEASE_RETRY_TARGETS = [
  // Retry the failed 3.0.18.24 lifecycle while preserving the vendor Burn
  // uninstaller's explicit 3010 pending-reboot completion signal.
  'Datto.WindowsAgent',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...BRITYMEETING_USER_SCOPE_RELEASE_RETRY_TARGETS,
] as const;

const POWERSHELL_REGISTERED_UNINSTALL_RELEASE_RETRY_TARGETS = [
  // Retry NammaAgent now that its exact registered powershell -File
  // uninstaller can be resolved below the captured install location.
  'SanthoshReddy352.NammaAgent',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...REBOOT_REQUIRED_UNINSTALL_RELEASE_RETRY_TARGETS,
] as const;

const ROBOTC_WRAPPER_UNINSTALL_RELEASE_RETRY_TARGETS = [
  // Retry the failed 4.56 lifecycle through the same manifest-hashed
  // InstallShield wrapper after direct MSI removal stalled in HelpDocs.
  'Robomatter.ROBOTC.LEGOMindstorms',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...POWERSHELL_REGISTERED_UNINSTALL_RELEASE_RETRY_TARGETS,
] as const;

const ZOHO_MAIL_USER_SCOPE_RELEASE_RETRY_TARGETS = [
  // Retry the failed 1.10.3 lifecycle in the per-profile context where the
  // Nullsoft installer actually registers and retains its uninstaller.
  'Zoho.Mail',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...POWERSHELL_REGISTERED_UNINSTALL_RELEASE_RETRY_TARGETS,
] as const;

const BARRYCARLYON_USER_SCOPE_RELEASE_RETRY_TARGETS = [
  // Retry the failed 1.4.0 lifecycle in the signed-in user's profile where
  // the Nullsoft uninstaller is registered and retained for managed removal.
  'BarryCarlyon.BarryCarlyonExtensionTools',
  // Carry every still-unconsumed targeted retry across the atomic pin.
  ...ZOHO_MAIL_USER_SCOPE_RELEASE_RETRY_TARGETS,
] as const;

const TOOLCHAIN_TERMINAL_RETRY_TARGETS: Readonly<Record<string, readonly string[]>> = {
  'f47779dbec9572a0ad72e59413b81dee8e0d13f7':
    BARRYCARLYON_USER_SCOPE_RELEASE_RETRY_TARGETS,
  '3d10fde499ebe5f2987a44db5df35c3801a519ea':
    ZOHO_MAIL_USER_SCOPE_RELEASE_RETRY_TARGETS,
  '89c8a2c5ef6b2358e50984fc8357e3f56ffcc5cf':
    POWERSHELL_REGISTERED_UNINSTALL_RELEASE_RETRY_TARGETS,
  '2b38ecc29469abcc4045cc7a1ff27229c196115b':
    POWERSHELL_REGISTERED_UNINSTALL_RELEASE_RETRY_TARGETS,
  '3a1a14e69d4d290515e8617339dab5717cc83629':
    ROBOTC_WRAPPER_UNINSTALL_RELEASE_RETRY_TARGETS,
  '22f30aa42fc522cf00d0fa3f1561563d0d4372d5':
    POWERSHELL_REGISTERED_UNINSTALL_RELEASE_RETRY_TARGETS,
  '83c81768f8c1800a5296251e473b758c62ec9358':
    POWERSHELL_REGISTERED_UNINSTALL_RELEASE_RETRY_TARGETS,
  'f097b209eb78ec946e2963f96da254a52141eb08':
    POWERSHELL_REGISTERED_UNINSTALL_RELEASE_RETRY_TARGETS,
  '0b1d12320b39afb69d1d1dac6db566b09ef9e2b7':
    POWERSHELL_REGISTERED_UNINSTALL_RELEASE_RETRY_TARGETS,
  '43fbb6c586da8919c35c7409a38377b8188914c2':
    POWERSHELL_REGISTERED_UNINSTALL_RELEASE_RETRY_TARGETS,
  '68a58563b15a5b09d32afa6a4d805e61a9e5635f':
    POWERSHELL_REGISTERED_UNINSTALL_RELEASE_RETRY_TARGETS,
  '80675c437cc4fe894c8b65a08b8e98ed80a25138':
    REBOOT_REQUIRED_UNINSTALL_RELEASE_RETRY_TARGETS,
  '105adee4044b86a29f824581c8383cbd06101eae':
    BRITYMEETING_USER_SCOPE_RELEASE_RETRY_TARGETS,
  '8712fc3a1a0239d34083952cda0f0a6676d0bb18':
    SEAMEET_USER_SCOPE_RELEASE_RETRY_TARGETS,
  '12fed0efb16de79951e9d3761c737aa382560e12':
    QDIR_UNSUPPORTED_UNINSTALL_RELEASE_RETRY_TARGETS,
  'ce809649aed63f1127aa256cbafb8d085e193951':
    SKETCHUPVIEWER_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS,
  // Ximalaya Live is eligibility-blocked after its exact user-scope /S
  // lifecycle failed, so carry prior bounded targets without replaying it.
  '3887e769d1e6bfdea2027b73c1e287203aa8f3f7':
    SWITCHBAR_USER_SCOPE_RELEASE_RETRY_TARGETS,
  '8dde5049437903912ac003cea71e2fef0e85e86c':
    SWITCHBAR_USER_SCOPE_RELEASE_RETRY_TARGETS,
  '0dfe1593dbf19ef43beceb2574c440287eaf1dc8':
    WOWUP_BETA_USER_SCOPE_RELEASE_RETRY_TARGETS,
  '54f0c26d3dbda39f78367178345c7d33eb214ec3':
    ANDROID_APPS_MANAGER_USER_SCOPE_RELEASE_RETRY_TARGETS,
  '8127bf1923e4a4863758acdebbe7f28f6a999790':
    LOGITECH_LGS_SYSTEM_EXECUTION_RELEASE_RETRY_TARGETS,
  'd019be69468b73ca47974c25e47932c589976624':
    LOGITECH_LGS_SYSTEM_EXECUTION_RELEASE_RETRY_TARGETS,
  'b09111db20f3aa13aced140d1bddbc83c437d459':
    IRFANVIEW_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS,
  'e029c0e9f7884eb07ba8f277413298ec354fb597':
    JAMOVI_REGISTERED_IDENTITY_RELEASE_RETRY_TARGETS,
  '085de20195dacc66c0d465945f93c6a780cc14c4':
    POLY_LENS_RENAMED_IDENTITY_RELEASE_RETRY_TARGETS,
  '5636cda74d31de95d9ee5689050ba04e432ede61':
    TOTAL_COMMANDER_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS,
  '384d36477200c3410f47645e376fe2dfd3682a9e':
    WINDOWS_APP_RUNTIME_13_RELEASE_RETRY_TARGETS,
  // Stream Deck is eligibility-blocked after five identical MSI removal
  // stalls, so carry every prior bounded target without replaying it.
  'd30bedbc4374346b7900b4ffef2d7c77f222d3d2':
    EGNYTE_UPDATE_ON_BOOT_RELEASE_RETRY_TARGETS,
  '63219f1fe5c953c8fd799c79030176444ba637b4':
    STREAM_DECK_EXISTING_HELPER_RELEASE_RETRY_TARGETS,
  'eee661ae3eab578d011dd5052df5e901ffa3a4bf':
    EGNYTE_UPDATE_ON_BOOT_RELEASE_RETRY_TARGETS,
  'ab0fbf7d35ad601611d4d4ca1029df826dbdfde9':
    EGNYTE_UPDATE_ON_BOOT_RELEASE_RETRY_TARGETS,
  'b798917a85465cb2fe7b55582322d1e30b20e088':
    AUTODESK_DESKTOP_CONNECTOR_ODIS_RELEASE_RETRY_TARGETS,
  '3400509334e29c78e960ba3b05ba3e4bec408b87':
    IOBIT_DETAIN_UNINSTALL_RELEASE_RETRY_TARGETS,
  'f7be39a95d529bc613f0ec8d4f2483762a5e02a2':
    IOBIT_INNO_UNINSTALL_RELEASE_RETRY_TARGETS,
  '943851a66f72cf115e2d97058a6415ee71e3f50f':
    IDM_WINDOW_AUTOMATION_RELEASE_RETRY_TARGETS,
  'c649792a94f23b4c3fc04e07b81c4aa655887301':
    IDM_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS,
  'd8642e4a6e3ee867fd8dfaf5bae632fbe24200f5':
    PLAYNITE_PROCESS_CLOSE_RELEASE_RETRY_TARGETS,
  '937a4d51d8c62885f76cb896fa3d742069436ee2':
    WATERFOX_SILENT_UNINSTALL_RELEASE_RETRY_TARGETS,
  // Speek is eligibility-blocked after its reviewed machine install contract
  // failed, so carry the bounded set without replaying Speek or DesktopOK.
  '44c38ddec97b546c7423374e09387d812e2386cc':
    SPEEK_BLOCK_RELEASE_RETRY_TARGETS,
  // DesktopOK is eligibility-blocked, so this release carries the prior
  // bounded retry set without replaying its unsupported removal lifecycle.
  'd64f6815b43c16428d83cde1b909e6503d7cc40f':
    DESKTOPOK_BLOCK_RELEASE_RETRY_TARGETS,
  'fe8a13f4473a3528368d7a97ff410df1961c594a':
    REDISINSIGHT_USER_SCOPE_RELEASE_RETRY_TARGETS,
  '2eaa857bc5a1297ec7e7b521307079de4622b0b7':
    ATLASSIAN_QUIET_UNINSTALL_RELEASE_RETRY_TARGETS,
  '326eafef044af8579bc0089c9556a3d59e26cbe0':
    LEAF_ONLY_UNINSTALL_PATH_RELEASE_RETRY_TARGETS,
  '2d3d1b82c818613b2bd677ddbcf309e1f6dd12b1':
    SURFSHARK_VISIBLE_PRIMARY_RELEASE_RETRY_TARGETS,
  'bb762159825bb59be2649f4cff4bf25fbbaef8b8':
    AMBIGUOUS_UNINSTALL_DIAGNOSTICS_RELEASE_RETRY_TARGETS,
  '228cd9def01122182631c91910554c05e9181edb':
    VISUAL_STUDIO_BUILD_TOOLS_INSTALL_PATH_RELEASE_RETRY_TARGETS,
  '20fbdeff5e6a4dc9d911019a244f7e46ab19b708':
    VISUAL_STUDIO_BUILD_TOOLS_RELEASE_RETRY_TARGETS,
  'c1c9410f58318d055c09a60bc067996a4b9b4597':
    CHROME_BETA_REGISTRY_RELEASE_RETRY_TARGETS,
  '00983d36128aef319cc36f901beeff6dd03d847f':
    FSLOGIX_RELEASE_RETRY_TARGETS,
  'db444b2d99905ecbf17ed20e20bfa0b3abc1aeec': [
    // Retry Webroot with the vendor-documented SME quiet MSI property after its
    // default -null command line retained the global MSI mutex past 30 minutes.
    'Webroot.SecureAnywhere',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Tricentis.NeoLoad',
    'Piriform.Recuva',
    'Trimble.SketchUp.2022',
    ...MIKTEX_RELEASE_RETRY_TARGETS,
  ],
  'ecc0b406cf37259aed2947e4d9b26af5c2abf648': [
    // Retry Webroot with the measured 30-minute ceiling after its signed MSI
    // remained active beyond the former 15-minute bound in production QA.
    'Webroot.SecureAnywhere',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Tricentis.NeoLoad',
    'Piriform.Recuva',
    'Trimble.SketchUp.2022',
    ...MIKTEX_RELEASE_RETRY_TARGETS,
  ],
  '3af4748ef271a2abb26003b2c42182a2769c8b53': [
    // Retry Webroot with the supported PSADT process handle after the pinned
    // toolkit's MSI no-wait wrapper rejected the exact installer path.
    'Webroot.SecureAnywhere',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Tricentis.NeoLoad',
    'Piriform.Recuva',
    'Trimble.SketchUp.2022',
    ...MIKTEX_RELEASE_RETRY_TARGETS,
  ],
  '59686c39a99aa6202d2d4c8ef947e81a4eb0ef38': [
    // Retry Webroot with an observable bounded wait around its long-running
    // MSI custom action instead of classifying the quiet work as stalled.
    'Webroot.SecureAnywhere',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Tricentis.NeoLoad',
    'Piriform.Recuva',
    'Trimble.SketchUp.2022',
    ...MIKTEX_RELEASE_RETRY_TARGETS,
  ],
  'c163bad8c16908ada436222bc2cdba0bf49f794e': [
    // Retry NeoLoad with install4j's documented unattended uninstall argument.
    'Tricentis.NeoLoad',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Piriform.Recuva',
    'Trimble.SketchUp.2022',
    'Webroot.SecureAnywhere',
    ...MIKTEX_RELEASE_RETRY_TARGETS,
  ],
  'dcaffc9d6fc7e9afb94fcf9a3035426a0156ee0d': [
    // Retry Recuva with its manifest-declared full-width success codes.
    'Piriform.Recuva',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Trimble.SketchUp.2022',
    'Webroot.SecureAnywhere',
    ...MIKTEX_RELEASE_RETRY_TARGETS,
  ],
  'dde6e9ae4e569568b4a15c087ba711d1bb3a8895': [
    // Retry SketchUp 2022 with its reviewed silent removal argument.
    'Trimble.SketchUp.2022',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Webroot.SecureAnywhere',
    ...MIKTEX_RELEASE_RETRY_TARGETS,
  ],
  'b67135eb2f947485e54c2583cfb6083b1e2f24ba': [
    // Retry Webroot with its published unattended MSI lifecycle.
    'Webroot.SecureAnywhere',
    // Carry every still-unconsumed bounded target across the atomic pin.
    ...MIKTEX_RELEASE_RETRY_TARGETS,
  ],
  '49775d3657a1b11b4ec1603e80ba8f78882b174f': MIKTEX_RELEASE_RETRY_TARGETS,
  '765d02a3041cc304d2df403aafc18b6f14258f59': [
    // Retry QQ NT with its reviewed non-interactive registered uninstaller.
    'Tencent.QQ.NT',
    // Carry every still-unconsumed bounded target across the atomic pin.
    ...MIKTEX_RELEASE_RETRY_TARGETS,
  ],
  '98019d2c6e06ff51a35d178bedc41f9f67a99107': MIKTEX_RELEASE_RETRY_TARGETS,
  'a2fa7cc7aec6faf0b22c0dcb7146ea8301ee9918': ELEGANT_CLIPBOARD_RELEASE_RETRY_TARGETS,
  'ffb7638dd870b188654c84673663b8ff151a7985': [
    // Retry Amazon Music with its reviewed fifteen-minute uninstall deadline.
    'Amazon.Music',
    // Carry every still-unconsumed bounded target across the atomic pin.
    ...EMPTY_ARGUMENT_PREDECESSOR_RETRY_TARGETS,
  ],
  'cf5933d805df9dae22d6ff4d1ace03f5dd4c1655': [
    // Retry Amazon Music with its reviewed extended uninstall deadline.
    'Amazon.Music',
    // Carry every still-unconsumed bounded target across the atomic pin.
    ...EMPTY_ARGUMENT_PREDECESSOR_RETRY_TARGETS,
  ],
  '3add630cf3483c2e9ecff61647ca23b727295b9a': [
    // Retry Amazon Music with its exact reviewed argument-free contract.
    'Amazon.Music',
    // Carry every still-unconsumed bounded target across the atomic pin.
    ...EMPTY_ARGUMENT_PREDECESSOR_RETRY_TARGETS,
  ],
  '3ce4c3b514ade5658515f6ba9d7a790f695e44f3': [
    // Retry Amazon Music now that argument-free EXE launches omit PSADT's
    // invalid empty ArgumentList parameter.
    'Amazon.Music',
    // Carry every still-unconsumed bounded target across the atomic pin.
    ...EMPTY_ARGUMENT_PREDECESSOR_RETRY_TARGETS,
  ],
  'c2af5b6dfdd0a6bf44d344366abc23878c23d48b': EMPTY_ARGUMENT_PREDECESSOR_RETRY_TARGETS,
  '1490844284f84f807e207fb9970bddc499bbe446': [
    // Evernote's NSIS uninstaller cannot finish while its desktop process is
    // active. This release closes it through the shared PSADT lifecycle.
    'Evernote.Evernote',
    // Preserve the targeted validation for the immediately preceding HP Image
    // Assistant lifecycle fix until that failed payload records a passing run.
    'HP.ImageAssistant',
  ],
  '34189c6876f0fe4539b971ba1b9e962ff66cd259': [
    // HP Image Assistant is a SoftPaq extractor with no ARP lifecycle. This
    // release verifies and removes its exact managed SWSetup payload for both
    // QA and customer packages.
    'HP.ImageAssistant',
  ],
  '9f3105f568ec221fb672a53f1dbafdf01cd2e8b5': [
    // Opera GX's registered slash command exits without removing the browser.
    // This release uses the reviewed machine-wide double-dash lifecycle.
    'Opera.OperaGX',
  ],
  '4ca2932ca8ff26578cade36457f0fcc150513e4c': [
    // Dell's registered InstallShield helper ignored documented silent removal
    // switches. This release invokes the original hash-verified Dell Update
    // Package with /passthrough /silent /remove.
    'Dell.Optimizer',
  ],
  '4ca55ff8ac8d4d5f6d07665adbe06a07f0110006': [
    // Dell Optimizer's registered removal command is interactive and leaves
    // its exact ARP identity. This release applies Dell's documented
    // unattended /silent /remove lifecycle to QA and customer packages.
    'Dell.Optimizer',
  ],
  '3fce249f5021c120a23ed0ab5dc726baaf060f3e': [
    // Claude Code ships as a bare portable executable. Earlier releases
    // generated an incomplete archive command for it; this release installs
    // bare portable payloads through the reviewed copy lifecycle.
    'Anthropic.ClaudeCode',
    // Platform Tools is a plain zip with no nested installer contract. This
    // release stages such archives as complete portable folders instead of
    // failing with the nested installer requirement.
    'Google.PlatformTools',
  ],
  '9214e4b5b71508bfba9aa1a2d4de5c3c771d3fea': [
    // Viber's machine-declared MSI resolves LocalAppData into the SYSTEM
    // profile and its VerifyInstalledFiles action then fails with 1603. The
    // shared adapter now packages this vendor installer in reviewed user scope.
    'Rakuten.Viber',
  ],
  '8235887e7126972b89c264e2053c1c4f7418ea74': [
    // Opera removes its product registration while retaining a small assistant
    // payload. This release verifies the exact ARP identity after running the
    // reviewed launcher command instead of waiting for the directory to vanish.
    'Opera.Opera',
  ],
  '5f95d233998479791a49d1d784ea95137c098e73': [
    // Opera's registered slash-form uninstall verb exits without removing the
    // product. This release invokes the reviewed double-dash launcher command
    // exactly and verifies that the machine installation directory disappears.
    'Opera.Opera',
  ],
  '2e68a941d3410e4eb7c6ed1e73fbc0eff290c807': [
    // These extractors have no single vendor ARP identity. The new managed
    // directory contract verifies their real payload and removes it through
    // either exact folder ownership or the documented vendor lifecycle.
    'Microsoft.OfficeDeploymentTool',
    'Microsoft.VisualStudio.BuildTools',
    // Opera now receives an explicit profile-retention choice so its SYSTEM
    // uninstaller cannot wait behind that unresolved prompt.
    'Opera.Opera',
  ],
  'cf24633576b6c5efcca5fbde8ffe7fb4f0f57272': [
    // Camera Hub's MSI launches a fresh --pre-uninstall --quit helper after
    // PSADT closes the desktop process. This release gives only that reviewed
    // command line a grace period before ending it so MSI removal can finish.
    'Elgato.CameraHub',
  ],
  '54515b6566ff4e7c9040fa24a8eba6b6347ef09e': [
    // ZIP is the package transport, not the registered uninstall engine.
    // This release carries the nested Inno type into both QA and customer
    // packages so MPC-BE receives the fully unattended uninstall switches.
    'MPC-BE.MPC-BE',
    // Carry the two reviewed lifecycle retries through the atomic toolchain
    // rollout; neither completed successfully on the preceding pin.
    'Elgato.CameraHub',
    'Microsoft.VSTOR',
  ],
  '2eea7f106971cda783665a60eb4d0e25846dae46': [
    // MPC-BE's Inno QuietUninstallString uses only /SILENT and can wait behind
    // an invisible prompt in SYSTEM context. This release normalizes all Inno
    // registrations to the fully unattended, message-box-free switch set.
    'MPC-BE.MPC-BE',
    // Camera Hub starts its desktop process during install and its MSI removal
    // custom action waits for that process. The shared application adapter now
    // closes it before invoking the exact MSI product uninstall.
    'Elgato.CameraHub',
    // VSTO's visible External Installer entry contains a bare install.exe.
    // The shared application adapter now supplies its unattended removal
    // switches instead of accepting the helper's no-op exit code.
    'Microsoft.VSTOR',
  ],
  '2dca138ee2fe27dc45166dba536511aa80d8937e': [
    // EAUninstall.exe remains blocked while the EA client/background process
    // family owns the installation. This release closes those reviewed
    // processes before invoking the exact registered helper.
    'ElectronicArts.EADesktop',
  ],
  'e6a4ae2f4f9a3a672c6912ab8e309483f53003b7': [
    // EA Desktop registers a purpose-built EAUninstall.exe helper. This
    // release prefers that exact helper while retaining the packaged Burn
    // bootstrapper fallback for disposable cache registrations.
    'ElectronicArts.EADesktop',
  ],
  '2c40f49e2cb0b5a1f7a1c27996f5aee72553a074': [
    // Carry the multi-product runtime replay through the atomic rollout; it
    // was queued but had not run before the PostgreSQL family fix superseded it.
    'abbodi1406.vcredist',
    // EnterpriseDB PostgreSQL releases share the same BitRock uninstaller.
    // This release applies the reviewed unattended arguments to the family.
    'PostgreSQL.PostgreSQL.13',
  ],
  '670357c92fefa433036d8667dd5f382731d8326e': [
    // VisualCppRedist AIO deliberately creates many independently registered
    // shared runtimes. This release verifies that reviewed multi-product
    // evidence without weakening the ordinary one-product identity rule.
    'abbodi1406.vcredist',
  ],
  '7e83c363bcbafca153f00113b12ede2e332b2d2d': [
    // Qfinder Pro omitted its x86 Visual C++ runtime from the WinGet
    // manifest and left its launched process blocking NSIS removal. This
    // release corrects both paths in QA and customer packages.
    'QNAP.QfinderPro',
  ],
  '681b7510f7f30bec92c17581213c9ebc7f72765a': [
    // Opera's former /silent adapter was removed by the vendor. This release
    // switches both QA and customer packaging to --runimmediately.
    'Opera.Opera',
    // Greenshot never reached the VM because the pinned PSADT template download
    // was interrupted. The protected runner now has a verified persistent tool
    // cache, so carry that infrastructure error through one bounded replay.
    'Greenshot.Greenshot',
  ],
  '7d389dbd6e55b719e3d71772717cda0c8f724469': [
    // Opera's registered uninstaller is interactive unless /silent is added.
    // This release applies that reviewed lifecycle adapter to QA and customer
    // packages, so the exact failing version receives one bounded replay.
    'Opera.Opera',
    // These bounded retries were queued on the preceding release when this
    // pin superseded it. Carry them once so a toolchain rollout cannot discard
    // already-selected customer coverage work.
    'AnalogDevices.LTspice',
    'Autodesk.DesktopApp',
    'Granola.Granola',
    'Greenshot.Greenshot',
    'Makeblock.xToolStudio',
    'Microsoft.EdgeWebView2Runtime',
  ],
  '9ff409ddabd3b1b4f8c65ad03b1f9e37778589fc': [
    // One bounded replay is required after the QA runner learned to collect
    // PSADT logs from the active interactive-user profile. Granola's newer
    // user-scoped release failed without those diagnostics, while its prior
    // version passed through the same customer packaging path.
    'Granola.Granola',
    'Microsoft.EdgeWebView2Runtime',
  ],
  'f4bc37886e490ece525c701562869734a7e366d5': [
    'Microsoft.EdgeWebView2Runtime',
  ],
  '93321ef6f7abd287f0fd6f37e37c5f4c199f3c4e': [
    'AnalogDevices.LTspice',
    // The xTool retry was superseded while this release was deploying, so
    // carry it forward until it receives one bounded run on the new toolchain.
    'Makeblock.xToolStudio',
  ],
  'b3b2729bab6959a554c0e6d41af0a841d6177386': [
    'Makeblock.xToolStudio',
  ],
  '072dc26c5c25369bf01f265af5af17c47c0e50e5': [
    'Microsoft.SQLServerManagementStudio.21',
    'Microsoft.SQLServerManagementStudio.22',
    'Microsoft.SQLServerManagementStudio.22.Preview',
  ],
  'bbd8948f2bbefeaba9caf51f6e36ce5d26fdff35': [
    'Microsoft.SQLServerManagementStudio.22',
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
    'Mozilla.Firefox.de',
  ],
  '1b130924ecc68909d6bb15f8cdf295944255a2f9': [
    'HandBrake.HandBrake',
    'Microsoft.VisualStudio.2019.Enterprise',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.WindowsApp',
    'PostgreSQL.PostgreSQL.18',
    'RARLab.WinRAR',
    'SoftwareOK.Q-Dir',
  ],
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
  '404c9718a2c977722850bc9d70a02772a9bd1c7a': [
    // PDFsam's WinGet /quiet command stalled under LocalSystem. This release
    // replaces it with the vendor-documented managed MSI property set.
    'PDFsam.PDFsam',
  ],
  'd67ec022c5edcd89b8d84edb958b4f1c494da5b5': [
    // PDFsam's reviewed MSI command remains present in this cumulative
    // packager release, so preserve its still-unconsumed bounded retry.
    'PDFsam.PDFsam',
    // MEGAsync defaults silent NSIS installs to CurrentUser. This release
    // adds the vendor's /MULTIUSER switch for LocalSystem deployments.
    'Mega.MEGASync',
  ],
  'f7c3ed00118ada623d70503009d1f72a164f1d95': [
    // Preserve the still-unconsumed reviewed PDFsam and MEGAsync retries in
    // this cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    // Link Controller's Inno uninstaller left its exact ARP key while the
    // tray/background process family was still active. This release closes
    // those reviewed processes through PSADT before vendor removal.
    'Insta360.Link.Controller',
  ],
  '0565fb456b7faf84cca56f2c988c99591015fe93': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    // SetPoint's NSIS removal left its ARP identity while the notification-area
    // client family was active. This release closes those reviewed processes
    // through PSADT before vendor removal.
    'Logitech.SetPoint',
  ],
  '77ed8d66246e8c7098f427e32d8488bc73f8eb3d': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    // Timely publishes `Memory` as a stable NSIS ProductCode. This release
    // binds that exact registry key so install verification and removal do not
    // depend on ambiguous display-name matching.
    'Timely.Memory',
  ],
  'c14531559086f83364ce69178369bf9462bcd872': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    // Google Drive launches its versioned uninstaller asynchronously. This
    // release appends Google's documented --silent --force_stop contract so
    // the exact ARP product is removed under non-interactive LocalSystem.
    'Google.GoogleDrive',
  ],
  '00fa68c7a24afe9db434cef87baa42455ed81fbb': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    // Dropbox's enterprise offline installer leaves the desktop process
    // running, which blocks its captured machine uninstaller. This release
    // closes the reviewed process through the shared PSADT lifecycle.
    'Dropbox.Dropbox',
  ],
  '20e762d9c48a90881d9901c93d3f84f2d9474654': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    // The previous Dropbox retry proved that closing the client alone is not
    // enough. This release installs without launching Dropbox and appends /S
    // to its captured machine uninstaller for a fully unattended lifecycle.
    'Dropbox.Dropbox',
  ],
  '719d7fd6db57ce5cbcecad528d53ae9c9088616f': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    // Partition Assistant can keep its Inno uninstaller interactive while
    // its desktop process is active. This release closes PartAssist through
    // PSADT and supplies the complete unattended Inno removal contract.
    'AOMEI.PartitionAssistant',
  ],
  '6db4e201f11e49bceb4d2729a2bc77fb0e675e89': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    // AOMEI uses /S rather than generic Inno switches. The exact reviewed
    // vendor command is now authoritative in QA and customer packages.
    'AOMEI.PartitionAssistant',
  ],
  '0c2765c26b69619df8f581190f4e67d97d79b589': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    // Preserve AOMEI's registered /SILENT argument under the exact reviewed
    // command guard after both generic Inno switches and /S proved no-ops.
    'AOMEI.PartitionAssistant',
  ],
  '461c2757292d3b7bcde33682d3f7b33e566b1fea': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    // AOMEI's exact vendor command now preserves /SILENT while suppressing
    // custom message boxes, restarts, and the startup prompt under SYSTEM.
    'AOMEI.PartitionAssistant',
  ],
  '02f93d590887282aca0037412c8786785ddc6486': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    // Horizon Client's registered Burn helper omitted restart suppression and
    // shut down the device during removal. The shared packager now guarantees
    // the complete unattended Burn lifecycle for QA and customer packages.
    'Omnissa.HorizonClient',
  ],
  'ca77e52dc65a404eb81679c5188378bf4d69a692': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Omnissa.HorizonClient',
    // Autodesk ODIS keeps working after its bootstrap process exits. These
    // releases wait for the exact managed executable and ODIS completion,
    // then use Autodesk's manifest-driven unattended uninstall lifecycle.
    'Autodesk.NavisworksFreedom.2026',
    'Autodesk.NavisworksFreedom.2027',
  ],
  '94c8f81e38ac180048f86dbf2df7f987fa448676': [
    // Preserve unresolved, customer-deployed lifecycle retries through the
    // cumulative rollout. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Omnissa.HorizonClient',
    // Ecosia's captured Chromium command omitted the switch that suppresses
    // confirmation UI. This release appends --force-uninstall for one retry.
    'Ecosia.EcosiaBrowser',
  ],
  'af4dfb94c9109ca598abc16a4b8cad57f6790066': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Omnissa.HorizonClient',
    // IntelliJ publishes a stable, versioned non-MSI ProductCode. Preserve it
    // as the exact ARP registry key for QA and customer package lifecycle.
    'JetBrains.IntelliJIDEA.Ultimate',
  ],
  '22b8e738d51a612f68b01c83b705d2dabc3bbcff': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    // install4j registers its canonical .install4j uninstaller without quiet
    // arguments. The shared packager now applies its documented unattended mode.
    'Ringler.SnapformViewer',
  ],
  'cc143c874f2e84f06097cb199ad9998344040ded': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    // These MSI packages registered an authoritative ProductCode while their
    // parsed executable uninstall path was empty. The shared packager now
    // reaches the MSI branch before attempting any EXE path normalization.
    'Cisco.Jabber',
    'IPEVO.Visualizer',
  ],
  '25682a8899466dbfe72403556e854d7335e1ae8f': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    // This MSI app appends the exact package version to its ARP display name.
    // The shared packager now captures that one observed, version-agreeing identity.
    'IPEVO.VisualizerLTSE',
  ],
  'cfc6f269e1a818dd4a61b95121268f6991f78642': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    // Sonos uses an InstallShield Basic MSI bootstrapper. The shared packager
    // now sends one quoted /v payload so the embedded MSI receives /qn and the
    // restart-suppression properties instead of returning MSI error 1619.
    'Sonos.Controller',
  ],
  '5569c16d136f464cbc014f40c70645414c601751': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    // .NET Framework has no single dependable ARP identity. This release
    // verifies Microsoft's documented Full\Release DWORD and retains the
    // shared Windows runtime when IntuneGet relinquishes its marker.
    'Microsoft.DotNet.Framework.Runtime',
  ],
  '7c63f08735a32d428068d9e7fd467830096250a1': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    // Sonos' native launcher cannot install silently as LocalSystem. This
    // release extracts its embedded MSI inside the target context, validates
    // its exact product identity, and installs it through PSADT.
    'Sonos.Controller',
  ],
  'e6dfe920d82e0b62c5d5e420fb603f61acdb5a42': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    // Retry Sonos with fully headless embedded-MSI extraction. The previous
    // /qb path stalled under LocalSystem before the MSI could be installed.
    'Sonos.Controller',
  ],
  '81ad189d7e51026bd15681264f774f498429f526': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    // Retry Sonos through the documented InstallShield administrative-image
    // path. The previous /x command entered uninstall mode on the current
    // launcher and returned Windows Installer error 1605.
    'Sonos.Controller',
  ],
  'f70f65692afddaf7b249cdacdcbacb356822f4f0': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    // Retry Snapform with root-level install4j uninstall.exe recognition and
    // the framework's documented unattended removal arguments.
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
  ],
  '4d9a1c9cae5383b6bf44f7501e4bb0dc157c7e3f': [
    // Preserve every still-unconsumed reviewed lifecycle retry across the
    // atomic pin change. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    // The registered DWG FastView setup command is interactive unless the
    // vendor's reviewed /silent /uninstall contract is appended. Retry the
    // exact failed version once through the shared QA/customer adapter.
    'Gstarsoft.DWGFastView',
  ],
  '02caa5a067569ad1d1e017fc6f52f3ee4e152120': [
    // Carry every unconsumed bounded lifecycle retry through the atomic pin
    // rollout. Compatible passes are removed before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    // Give the exact failed DWG FastView version one final bounded retry with
    // the current /s /uninstall shared QA/customer packaging adapter.
    'Gstarsoft.DWGFastView',
  ],
  '7870c214b74ac666b16573ac42cbc9e65a3848e2': [
    // Carry the still-unconsumed bounded lifecycle retries through the atomic
    // pin rollout. DWG FastView is intentionally absent because the shared
    // eligibility gate now blocks its unsupported managed uninstall.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
  ],
  '1467e138d1e6f5f0cee3d8cda6f981c4d44f6b8f': [
    // Carry every still-unconsumed bounded retry across the atomic pin
    // rollout. Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    // Visual Studio 2022 and newer install 64-bit instances below Program
    // Files. Retry terminal outcomes through the corrected shared adapter.
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
  ],
  '82958ac0c0b39e06af14a87b70319251604910f7': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    // Keep the Visual Studio retries bounded while correcting the 2022 Build
    // Tools exception back to its documented Program Files (x86) root.
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
  ],
  '11933b94c72275551a565bed7364ebb8616e4414': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    // Retry the exact failed OpenWebStart release once with install4j's
    // documented unattended removal arguments.
    'karakun.OpenWebStart',
  ],
  '0b562aa574144a19a6b4c5e6c3d3d7a4c241961f': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    // Retry the exact failed MSYS2 release once with its reviewed registration
    // identity and official Qt Installer Framework removal command.
    'MSYS2.MSYS2',
  ],
  'a48022baddf7b3f312541ef2e127220f508104a8': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    // Retry the preparation failure once with registry-owned path discovery
    // and the reviewed Qt Installer Framework removal arguments.
    'MSYS2.MSYS2',
  ],
  '91abb42cf1096de692500203fc7373ef6a25a3dd': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    // Retry only the failed Tor lifecycle with its reviewed exact extracted
    // user-folder verification and removal behavior.
    'TorProject.TorBrowser',
  ],
  'fec554c1bc7139ef1e7b489571a09f29760b06c0': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    // Retry the exact failed PTC payload once with the official MSI-forwarding
    // command now shared by QA and customer PSADT packages.
    'PTC.CreoView.Express',
  ],
  'fbb4aa2eed6cc545ec343373dd8947d04463a4a1': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    // Retry the exact PTC payload with the published main MSI ProductCode.
    'PTC.CreoView.Express',
  ],
  '71ee706fe545cdcd8667545eb65e8ba62d82208c': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    // Battle.net declares InstallLocationRequired. Retry its exact failed
    // payload with the inherited WinGet install-location contract.
    'Blizzard.BattleNet',
  ],
  'f426e369f2134ca5bb896170c9f7fd7e526c5916': [
    // Autodesk Licensing Service does not expose a product ARP identity. This
    // release verifies its dedicated service payload and uses Autodesk's
    // documented unattended uninstaller.
    'Autodesk.LicensingService',
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '16a626f329d93d1e499c1db30a243d9dc18a2aa6': [
    // Bria keeps its desktop client running in the notification area. This
    // release closes that reviewed process before invoking the MSI lifecycle.
    'Bria.Bria',
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'ca46c0860496e13b91842f7106f45505441dc44d': [
    // Retry only the failed PotPlayer payload with its reviewed all-users
    // NSIS install contract shared by QA and customer PSADT packages.
    'Daum.PotPlayer',
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes and eligibility-blocked apps are filtered before
    // candidates are created.
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'b2e26a6954cf32d1541c52a2bd663f0aaad5f0d8': [
    // Carry still-unconsumed bounded retries through the fail-closed plain-EXE
    // rollout. Compatible passes and eligibility-blocked apps are filtered
    // before candidates are created.
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '9205d51e3c693afe7fdd385572f181c4739d91c5': [
    // Carry the still-unconsumed prior repair targets through the atomic pin
    // rollout; compatible passes and eligibility-blocked apps are filtered
    // upstream.
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '78dfd1a4113805acbd03fe52ddfe6bc06d90544d': [
    // Carry still-unconsumed bounded targets; compatible passes and
    // eligibility-blocked apps are filtered upstream.
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '77735e28d450c6b1c4f14a9a667bc5336eeeb3ea': [
    // Carry still-unconsumed bounded targets through the Acronis eligibility
    // release. The blocked Acronis package is intentionally absent and is
    // also filtered by the shared eligibility policy before enqueue.
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '7a8401469e353172b652259e731aa505cf8067bd': [
    // Ubuntu completed provisioning but the old package emitted no log entry
    // while Windows servicing was active, so QA terminated it as stalled.
    // Retry it with the shared Appx provisioning heartbeat release.
    'Canonical.Ubuntu.2404',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'c69410a6d1ab34e403b7ebb25519074acbe8952c': [
    // Logitech Presentation's signed NSIS bootstrapper raises an elevation
    // prompt in user context even with /S. Retry it with the reviewed
    // LocalSystem execution scope and Logitech's remote-deployment switches.
    'Logitech.Presentation',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '6788c71df2ec0844f829b5abe0f5b154ca3abdb4': [
    // Visual Studio 2017 was omitted from the shared instance-aware adapter
    // and fell back to an ARP command that left the product registered. Retry
    // Enterprise through Microsoft's exact Visual Studio Installer lifecycle.
    'Microsoft.VisualStudio.2017.Enterprise',
    // BankID is a ZIP with a nested MSI whose exact ProductCode was present
    // in trusted manifest metadata but previously dropped from the canonical
    // uninstall identity. Retry it through the shared QA/customer generator.
    'FinancialID.BankID',
    // OpenOffice's Nullsoft bootstrapper installs an MSI whose ARP display
    // name appends a marketing version. Retry it with the exact requested
    // DisplayVersion and strict configured-name-prefix identity contract.
    'Apache.OpenOffice',
    // Arduino IDE's dual-purpose MSI defaults to per-user installation even
    // though WinGet declares this installer machine-scope. Retry it now that
    // the shared normalizer explicitly carries that scope into MSI arguments.
    'ArduinoSA.IDE.stable',
    // G HUB's evergreen bootstrapper can remain active without console output,
    // and its registered bare software-manager command does not remove the
    // product under LocalSystem. Retry the exact failed customer-requested
    // package with the corrected generated argument expression, observable
    // install, and full silent removal adapter.
    'Logitech.GHUB',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '7391c73a8eacb01becfc76682bfbb37b1d60b17f': [
    // darktable's CPack/NSIS installer extracted its payload but was
    // interrupted by the generic inactivity guard before final registration.
    // Retry it through the shared bounded wait with PSADT heartbeats.
    'darktable.darktable',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '837c54ac684d6a3d36a0ad5f14f258f8add540cf': [
    // Autodesk Access registers the exact ODIS manifest removal command but
    // omits Autodesk's documented -q switch. Retry through the shared PSADT
    // packager now that the exact AdODIS signature is made unattended.
    'Autodesk.AutodeskAccess',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '81f443163ffb9f437be3901b44b6da74032032c4': [
    // NVM's official Inno setup requires administrative privileges despite
    // WinGet publishing it as user-scope. Retry it with the reviewed trusted-
    // byte selection, LocalSystem execution, and deterministic machine path.
    'CoreyButler.NVMforWindows',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '12831539c9dc30678c6f16367faab76820502d2a': [
    // CutePDF's registered unInstcpw helper requires its vendor-specific
    // /uninstall /s contract rather than the nested installer's Inno switches.
    'AcroSoftware.CutePDFWriter',
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '6af0cfac18f3c4653a69a01f41bc1170c1237807': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    // These registered vendor uninstallers are retried from a safe PSADT
    // working directory outside their own application trees.
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    // The installer executes from a version-shaped extensionless URL. Retry
    // once with the corrected executable filename in QA and customer packages.
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    // DATEV did not reach GitHub because the old 60-second Vercel function
    // window ended during exact installer preflight.
    'DATEV.SicherheitspaketCompact',
  ],
  '20546b8280874ba955b8d14182ad69bde8eacb58': [
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'b6254d8fdf1dd50ccc95fbb3e137a5ef5717cce5': [
    // ZeeDrive's MSI deliberately has no ARP registration. Retry its failed
    // lifecycle with the reviewed versioned Program Files contract.
    'Thinkscape.ZeeDrive',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'ab045cb1da3611f91329943fade2263491bb211d': [
    // Docker's legacy Edge-channel catalog title differs from its exact ARP
    // identity. Retry the failed lifecycle through the shared adapter.
    'Docker.DockerDesktopEdge',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '4918638adf111a664f2589ce79d8aefe79c33936': [
    // Podman Desktop's assisted NSIS installer defaults to the invoking user.
    // Retry the failed lifecycle with its reviewed all-users contract.
    'RedHat.Podman-Desktop',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'b42fb5d02883b199e057c466a2cd9a7b86d994d9': [
    // RMS Client's Burn child can remove its exact registration shortly after
    // the parent exits. Retry with the reviewed bounded completion window.
    'Microsoft.RMSClient',
    // Movavi installs and registers successfully before its signed NSIS
    // launcher returns 1223. Retry with the evidence-guarded success code.
    'Movavi.MovaviPhotoFocus',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '4bc4126f8991da9facd520d0bc213a7dd3ebbf5c': [
    // Retry the two failure paths corrected by this protected release.
    'Microsoft.RMSClient',
    'SoftwareOK.DesktopOK',
    // Movavi already passed on the preceding pin; compatibility filtering
    // prevents a duplicate while retaining it if reconciliation lagged.
    'Movavi.MovaviPhotoFocus',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'f79b14647328d39bca04dada822a07f70573aa49': [
    // Retry the two package-scope lifecycles corrected by this release.
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    // Compatibility filtering skips these completed validations while retaining
    // their retry intent if reconciliation has not yet recorded the pass.
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '31faef7cae75613243bc36c9bb0af38c88761437': [
    // Retry FSLogix with its reviewed Microsoft bundle display identity.
    'Microsoft.FSLogix',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'bd61ef8e81dac8b16289a4a572022d4d1702b333': [
    // Retry FSLogix with nested-EXE wrapper identity disambiguation enabled.
    'Microsoft.FSLogix',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '9aaebb8f2af8bf3144fb5358b8b34e99195c088e': [
    // Retry the exact customer profile whose saved marker root was omitted
    // from PSADT generation, causing post-install detection to fail.
    '8x8.Work',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'b29b7b930651b6b0d98eb5985ced7ee191550a3c': [
    // Retry Speek only after its reviewed non-ARP managed-directory lifecycle
    // is active for both QA and customer packaging.
    'Speek.Speek',
    // Carry every still-unconsumed bounded target across the atomic pin.
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '21fbdbc5a29ca42ac0d2dd1c5939b9ad1f94adc2': [
    // Retry RobotStudio with its reviewed MSI identity; never infer Edge.
    'ABB.RobotStudio',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Microsoft.msodbcsql.13',
    'Microsoft.WindowsAppRuntime.1.8',
    'AppiumDevelopers.AppiumInspector',
    'Autodesk.DesignReview',
    'BlueJTeam.BlueJ',
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '568f59b206634c6f7342f6d398cbdf7e3b650ed9': [
    // Retry ODBC 13 without leaking the trailing "iet" token from /quiet.
    'Microsoft.msodbcsql.13',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Microsoft.WindowsAppRuntime.1.8',
    'AppiumDevelopers.AppiumInspector',
    'Autodesk.DesignReview',
    'BlueJTeam.BlueJ',
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'fbc3d4483515b6c5e83a9c31fc46d02b4fa8abb0': [
    // Retry the failed developer pack through its exact legacy MSI identity.
    'Microsoft.DotNet.Framework.DeveloperPack.4.6',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Microsoft.WindowsAppRuntime.1.8',
    'AppiumDevelopers.AppiumInspector',
    'Autodesk.DesignReview',
    'BlueJTeam.BlueJ',
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'c0bc405098e377db345bb4304fc8e46f889415b2': [
    // Retry FlashPrint with the reviewed wait wired to its nested EXE.
    'Flashforge.FlashPrint',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Microsoft.WindowsAppRuntime.1.8',
    'AppiumDevelopers.AppiumInspector',
    'Autodesk.DesignReview',
    'BlueJTeam.BlueJ',
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'd47d2f11a544fcab04bfa20f1fc02e78940a0807': [
    // Retry FlashPrint through its reviewed bounded installer wait.
    'Flashforge.FlashPrint',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Microsoft.WindowsAppRuntime.1.8',
    'AppiumDevelopers.AppiumInspector',
    'Autodesk.DesignReview',
    'BlueJTeam.BlueJ',
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'aeb0d77229d31867de933fa3f24ff94be7ea3eab': [
    // Retry the shared runtime through its exact Appx framework identity.
    'Microsoft.WindowsAppRuntime.1.8',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'AppiumDevelopers.AppiumInspector',
    'Autodesk.DesignReview',
    'BlueJTeam.BlueJ',
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '912df5d19accc0344f7538596e353076c4a6f66c': [
    // Retry Appium Inspector in the vendor-configured signed-in user scope.
    'AppiumDevelopers.AppiumInspector',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Autodesk.DesignReview',
    'BlueJTeam.BlueJ',
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '06b92432e61d66eab624085dfd6db138d3778862': [
    // Retry Design Review with the bounded Autodesk ODIS lifecycle.
    'Autodesk.DesignReview',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'BlueJTeam.BlueJ',
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'd7293535636c41b795088f4d265e4e085445a05c': [
    // Retry BlueJ with the explicit Windows Installer 5 per-user context.
    'BlueJTeam.BlueJ',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '0ad6cdec44cd8ec47ce12c9ae59487f2fa9dda52': [
    // Retry BlueJ with its explicit user-writable MSI install directory.
    'BlueJTeam.BlueJ',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'f91af4469ba113dac1524f8764c4a03d535eb188': [
    // Retry the terminal BlueJ install path changed by this release.
    'BlueJTeam.BlueJ',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '8ed88e9a9889fec478235b1623e313f9fd86bd59': [
    // Retry the terminal Logi Bolt path changed by this release.
    'Logitech.LogiBolt',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'f5d7258e504f10679f54f025cebf11bfe9584221': [
    // Retry only the two terminal uninstall paths changed by this release.
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
};

export function terminalToolchainRetryTargets(packagerCommit: string): string[] {
  return [...(TOOLCHAIN_TERMINAL_RETRY_TARGETS[packagerCommit] || [])];
}

export function shouldRetryTerminalToolchainCandidate(
  packagerCommit: string,
  candidate: Pick<QaToolchainBackfillCandidate, 'wingetId' | 'status'>
): boolean {
  if (!['failed', 'error'].includes(candidate.status)) return true;
  const normalizedWingetId = candidate.wingetId.trim().toLowerCase();
  return (TOOLCHAIN_TERMINAL_RETRY_TARGETS[packagerCommit] || []).some(
    (wingetId) => wingetId.toLowerCase() === normalizedWingetId
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
