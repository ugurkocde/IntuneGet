/**
 * App Mappings
 * Pre-defined mappings between common app names and their Winget IDs
 */

import { getCatalogSource } from '@/lib/catalog';

export interface AppMapping {
  wingetId: string;
  aliases: string[];
  publisher?: string;
}

/**
 * Known app mappings for common applications
 * Maps display names and variations to Winget package IDs
 */
export const APP_MAPPINGS: AppMapping[] = [
  // Browsers
  {
    wingetId: 'Google.Chrome',
    aliases: ['google chrome', 'chrome', 'googlechrome'],
    publisher: 'Google',
  },
  {
    wingetId: 'Mozilla.Firefox',
    aliases: ['mozilla firefox', 'firefox', 'ff'],
    publisher: 'Mozilla',
  },
  {
    wingetId: 'Microsoft.Edge',
    aliases: ['microsoft edge', 'edge', 'msedge'],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'BraveSoftware.BraveBrowser',
    aliases: ['brave', 'brave browser'],
    publisher: 'Brave Software',
  },
  {
    wingetId: 'Opera.Opera',
    aliases: ['opera', 'opera browser'],
    publisher: 'Opera',
  },

  // Communication
  {
    wingetId: 'Zoom.Zoom',
    aliases: ['zoom', 'zoom client', 'zoom meetings'],
    publisher: 'Zoom',
  },
  {
    wingetId: 'Microsoft.Teams',
    aliases: ['microsoft teams', 'teams', 'ms teams'],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'SlackTechnologies.Slack',
    aliases: ['slack', 'slack desktop'],
    publisher: 'Slack',
  },
  {
    wingetId: 'Discord.Discord',
    aliases: ['discord', 'discord app'],
    publisher: 'Discord',
  },

  // Development
  {
    wingetId: 'Microsoft.VisualStudioCode',
    aliases: ['visual studio code', 'vs code', 'vscode', 'code'],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'Git.Git',
    aliases: ['git', 'git for windows'],
    publisher: 'Git',
  },
  {
    wingetId: 'GitHub.GitHubDesktop',
    aliases: ['github desktop', 'github'],
    publisher: 'GitHub',
  },
  {
    wingetId: 'JetBrains.IntelliJIDEA.Community',
    aliases: ['intellij', 'intellij idea', 'idea'],
    publisher: 'JetBrains',
  },
  {
    wingetId: 'JetBrains.PyCharm.Community',
    aliases: ['pycharm', 'pycharm community'],
    publisher: 'JetBrains',
  },
  {
    wingetId: 'Notepad++.Notepad++',
    aliases: ['notepad++', 'notepad plus plus', 'npp'],
    publisher: 'Notepad++',
  },
  {
    wingetId: 'Python.Python.3.12',
    aliases: ['python', 'python3', 'python 3'],
    publisher: 'Python',
  },
  {
    wingetId: 'OpenJS.NodeJS.LTS',
    aliases: ['node', 'nodejs', 'node.js'],
    publisher: 'OpenJS Foundation',
  },

  // Productivity
  {
    wingetId: '7zip.7zip',
    aliases: ['7zip', '7-zip', '7z'],
    publisher: '7-Zip',
  },
  {
    wingetId: 'RARLab.WinRAR',
    aliases: ['winrar', 'rar'],
    publisher: 'RARLAB',
  },
  {
    wingetId: 'VideoLAN.VLC',
    aliases: ['vlc', 'vlc media player', 'vlc player'],
    publisher: 'VideoLAN',
  },
  {
    wingetId: 'Adobe.Acrobat.Reader.64-bit',
    aliases: ['adobe reader', 'acrobat reader', 'adobe acrobat', 'pdf reader'],
    publisher: 'Adobe',
  },
  {
    wingetId: 'Foxit.FoxitReader',
    aliases: ['foxit reader', 'foxit', 'foxit pdf'],
    publisher: 'Foxit',
  },

  // Security
  {
    wingetId: 'KeePassXCTeam.KeePassXC',
    aliases: ['keepassxc', 'keepass'],
    publisher: 'KeePassXC',
  },
  {
    wingetId: 'Bitwarden.Bitwarden',
    aliases: ['bitwarden', 'bitwarden desktop'],
    publisher: 'Bitwarden',
  },

  // Remote Access
  {
    wingetId: 'TeamViewer.TeamViewer',
    aliases: ['teamviewer', 'team viewer'],
    publisher: 'TeamViewer',
  },
  {
    wingetId: 'AnyDeskSoftwareGmbH.AnyDesk',
    aliases: ['anydesk', 'any desk'],
    publisher: 'AnyDesk',
  },

  // Office & Documents
  {
    wingetId: 'TheDocumentFoundation.LibreOffice',
    aliases: ['libreoffice', 'libre office'],
    publisher: 'The Document Foundation',
  },

  // Microsoft 365 Apps
  {
    wingetId: 'Microsoft.Office',
    aliases: ['microsoft office', 'office 365', 'microsoft 365', 'm365'],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'Microsoft.OneDrive',
    aliases: ['onedrive', 'microsoft onedrive', 'one drive'],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'Microsoft.Outlook',
    aliases: ['outlook', 'microsoft outlook'],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'Microsoft.Word',
    aliases: ['word', 'microsoft word'],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'Microsoft.Excel',
    aliases: ['excel', 'microsoft excel'],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'Microsoft.PowerPoint',
    aliases: ['powerpoint', 'microsoft powerpoint', 'ppt'],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'Microsoft.Access',
    aliases: ['access', 'microsoft access'],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'Microsoft.Visio',
    aliases: ['visio', 'microsoft visio'],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'Microsoft.Project',
    aliases: ['project', 'microsoft project'],
    publisher: 'Microsoft',
  },

  // Adobe Creative Suite
  {
    wingetId: 'Adobe.CreativeCloud',
    aliases: ['adobe creative cloud', 'creative cloud', 'adobe cc'],
    publisher: 'Adobe',
  },
  {
    wingetId: 'Adobe.Photoshop',
    aliases: ['photoshop', 'adobe photoshop'],
    publisher: 'Adobe',
  },
  {
    wingetId: 'Adobe.Illustrator',
    aliases: ['illustrator', 'adobe illustrator'],
    publisher: 'Adobe',
  },
  {
    wingetId: 'Adobe.InDesign',
    aliases: ['indesign', 'adobe indesign'],
    publisher: 'Adobe',
  },
  {
    wingetId: 'Adobe.PremierePro',
    aliases: ['premiere', 'adobe premiere', 'premiere pro'],
    publisher: 'Adobe',
  },
  {
    wingetId: 'Adobe.AfterEffects',
    aliases: ['after effects', 'adobe after effects'],
    publisher: 'Adobe',
  },

  // Security Software
  {
    wingetId: 'Malwarebytes.Malwarebytes',
    aliases: ['malwarebytes', 'mbam'],
    publisher: 'Malwarebytes',
  },
  {
    wingetId: 'ESET.NOD32Antivirus',
    aliases: ['eset', 'nod32', 'eset antivirus'],
    publisher: 'ESET',
  },
  {
    wingetId: 'Sophos.SophosHome',
    aliases: ['sophos', 'sophos home'],
    publisher: 'Sophos',
  },
  {
    wingetId: 'CrowdStrike.FalconSensor',
    aliases: ['crowdstrike', 'falcon sensor', 'crowdstrike falcon'],
    publisher: 'CrowdStrike',
  },
  {
    wingetId: '1Password.1Password',
    aliases: ['1password', 'one password'],
    publisher: 'AgileBits',
  },
  {
    wingetId: 'LastPass.LastPass',
    aliases: ['lastpass', 'last pass'],
    publisher: 'LastPass',
  },
  {
    wingetId: 'Dashlane.Dashlane',
    aliases: ['dashlane'],
    publisher: 'Dashlane',
  },

  // VPN Clients
  {
    wingetId: 'Cisco.CiscoSecureClient',
    aliases: ['cisco anyconnect', 'anyconnect', 'cisco secure client', 'cisco vpn'],
    publisher: 'Cisco',
  },
  {
    wingetId: 'PaloAltoNetworks.GlobalProtect',
    aliases: ['globalprotect', 'global protect', 'palo alto vpn'],
    publisher: 'Palo Alto Networks',
  },
  {
    wingetId: 'Fortinet.FortiClient',
    aliases: ['forticlient', 'forti client', 'fortinet vpn'],
    publisher: 'Fortinet',
  },
  {
    wingetId: 'OpenVPNTechnologies.OpenVPN',
    aliases: ['openvpn', 'open vpn'],
    publisher: 'OpenVPN Technologies',
  },
  {
    wingetId: 'NordVPN.NordVPN',
    aliases: ['nordvpn', 'nord vpn'],
    publisher: 'NordVPN',
  },
  {
    wingetId: 'WireGuard.WireGuard',
    aliases: ['wireguard', 'wire guard'],
    publisher: 'WireGuard',
  },

  // Virtualization
  {
    wingetId: 'VMware.WorkstationPlayer',
    aliases: ['vmware player', 'vmware workstation player'],
    publisher: 'VMware',
  },
  {
    wingetId: 'VMware.WorkstationPro',
    aliases: ['vmware workstation', 'vmware workstation pro'],
    publisher: 'VMware',
  },
  {
    wingetId: 'Oracle.VirtualBox',
    aliases: ['virtualbox', 'virtual box', 'oracle virtualbox'],
    publisher: 'Oracle',
  },

  // Enterprise Tools
  {
    wingetId: 'ServiceNow.Agent',
    aliases: ['servicenow agent', 'servicenow'],
    publisher: 'ServiceNow',
  },
  {
    wingetId: 'Atlassian.Sourcetree',
    aliases: ['sourcetree', 'source tree'],
    publisher: 'Atlassian',
  },
  {
    wingetId: 'Postman.Postman',
    aliases: ['postman', 'postman app'],
    publisher: 'Postman',
  },
  {
    wingetId: 'Docker.DockerDesktop',
    aliases: ['docker', 'docker desktop'],
    publisher: 'Docker',
  },
  {
    wingetId: 'Kubernetes.kubectl',
    aliases: ['kubectl', 'kubernetes cli'],
    publisher: 'Kubernetes',
  },

  // Networking Tools
  {
    wingetId: 'Wireshark.Wireshark',
    aliases: ['wireshark', 'wire shark'],
    publisher: 'Wireshark Foundation',
  },
  {
    wingetId: 'Nmap.Nmap',
    aliases: ['nmap', 'network mapper'],
    publisher: 'Nmap Project',
  },

  // Media & Communication
  {
    wingetId: 'Webex.Webex',
    aliases: ['webex', 'cisco webex', 'webex meetings'],
    publisher: 'Cisco',
  },
  {
    wingetId: 'GoTo.GoToMeeting',
    aliases: ['gotomeeting', 'go to meeting'],
    publisher: 'GoTo',
  },
  {
    wingetId: 'BlueJeans.BlueJeans',
    aliases: ['bluejeans', 'blue jeans'],
    publisher: 'BlueJeans',
  },

  // Additional Utilities
  {
    wingetId: 'Greenshot.Greenshot',
    aliases: ['greenshot', 'green shot'],
    publisher: 'Greenshot',
  },
  {
    wingetId: 'ShareX.ShareX',
    aliases: ['sharex', 'share x'],
    publisher: 'ShareX',
  },
  {
    wingetId: 'Audacity.Audacity',
    aliases: ['audacity'],
    publisher: 'Audacity',
  },
  {
    wingetId: 'OBSProject.OBSStudio',
    aliases: ['obs', 'obs studio', 'open broadcaster'],
    publisher: 'OBS Project',
  },
  {
    wingetId: 'HandBrake.HandBrake',
    aliases: ['handbrake', 'hand brake'],
    publisher: 'HandBrake',
  },

  // Graphics
  {
    wingetId: 'GIMP.GIMP',
    aliases: ['gimp', 'gnu image manipulation'],
    publisher: 'GIMP',
  },
  {
    wingetId: 'Inkscape.Inkscape',
    aliases: ['inkscape', 'inkscape vector'],
    publisher: 'Inkscape',
  },

  // System Utilities
  {
    wingetId: 'Piriform.CCleaner',
    aliases: ['ccleaner', 'piriform ccleaner'],
    publisher: 'Piriform',
  },
  {
    wingetId: 'Microsoft.PowerToys',
    aliases: ['powertoys', 'power toys', 'microsoft powertoys'],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'PuTTY.PuTTY',
    aliases: ['putty', 'put ty'],
    publisher: 'Simon Tatham',
  },

  // Database
  {
    wingetId: 'dbeaver.dbeaver',
    aliases: ['dbeaver', 'dbeaver community'],
    publisher: 'DBeaver',
  },
  {
    wingetId: 'HeidiSQL.HeidiSQL',
    aliases: ['heidisql', 'heidi sql'],
    publisher: 'HeidiSQL',
  },

  // SCCM Common Enterprise Apps
  {
    wingetId: 'Microsoft.Office',
    aliases: [
      'microsoft 365 apps for enterprise',
      'microsoft 365 apps for business',
      'office 365 proplus',
      'm365 apps',
    ],
    publisher: 'Microsoft',
  },
  {
    wingetId: 'Citrix.Workspace',
    aliases: ['citrix workspace', 'citrix receiver', 'citrix workspace app'],
    publisher: 'Citrix',
  },
  {
    wingetId: 'SAP.SAPLogon',
    aliases: ['sap logon', 'sap gui', 'sap frontend'],
    publisher: 'SAP',
  },
  {
    wingetId: 'Splunk.UniversalForwarder',
    aliases: ['splunk forwarder', 'splunk universal forwarder', 'splunkforwarder'],
    publisher: 'Splunk',
  },
  {
    wingetId: 'SolarWinds.DamewareRemote',
    aliases: ['dameware', 'dameware remote', 'dameware mini remote'],
    publisher: 'SolarWinds',
  },
  {
    wingetId: 'Progress.MOVEit.Transfer',
    aliases: ['moveit', 'moveit transfer', 'ipswitch moveit'],
    publisher: 'Progress',
  },
  {
    wingetId: 'BMCSoftware.FootPrints',
    aliases: ['footprints', 'bmc footprints', 'numara footprints'],
    publisher: 'BMC Software',
  },
  {
    wingetId: 'ManageEngine.DesktopCentral',
    aliases: ['desktop central', 'manageengine desktop central', 'zoho desktop central'],
    publisher: 'ManageEngine',
  },
  {
    wingetId: 'Ivanti.Workspace',
    aliases: ['ivanti workspace', 'landesk', 'ivanti endpoint manager'],
    publisher: 'Ivanti',
  },
  {
    wingetId: 'Trend.ApexOne',
    aliases: ['apex one', 'trend apex one', 'officescan', 'trend micro apex one'],
    publisher: 'Trend Micro',
  },
  {
    wingetId: 'Symantec.EndpointProtection',
    aliases: ['symantec endpoint', 'sep', 'symantec endpoint protection', 'broadcom endpoint protection'],
    publisher: 'Broadcom',
  },
  {
    wingetId: 'McAfee.Agent',
    aliases: ['mcafee agent', 'mcafee endpoint', 'trellix agent'],
    publisher: 'McAfee',
  },
];

/**
 * Minimum normalized length required before substring (includes) matching
 * is allowed. Shorter aliases/names only match via exact equality, otherwise
 * short aliases like "ff" (Firefox) would match inside unrelated names like
 * "microsoftoffice".
 */
const MIN_SUBSTRING_MATCH_LENGTH = 6;

/**
 * Get Winget ID from app name
 */
export function getWingetIdFromName(name: string): string | null {
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const mapping of APP_MAPPINGS) {
    // Check aliases
    for (const alias of mapping.aliases) {
      const normalizedAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedName === normalizedAlias) {
        return mapping.wingetId;
      }
      if (
        normalizedAlias.length >= MIN_SUBSTRING_MATCH_LENGTH &&
        normalizedName.includes(normalizedAlias)
      ) {
        return mapping.wingetId;
      }
    }

    // Check Winget ID itself
    const normalizedId = mapping.wingetId.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalizedName === normalizedId || normalizedName.includes(normalizedId)) {
      return mapping.wingetId;
    }
    if (
      normalizedName.length >= MIN_SUBSTRING_MATCH_LENGTH &&
      normalizedId.includes(normalizedName)
    ) {
      return mapping.wingetId;
    }
  }

  return null;
}

/**
 * Get mapping info by Winget ID
 */
export function getMappingByWingetId(wingetId: string): AppMapping | null {
  return APP_MAPPINGS.find(
    (m) => m.wingetId.toLowerCase() === wingetId.toLowerCase()
  ) || null;
}

/**
 * Curated app result from database lookup
 */
export interface CuratedAppMatch {
  wingetId: string;
  name: string;
  publisher: string;
  latestVersion: string | null;
}

/**
 * Search curated apps in the database
 * Only returns apps that have been verified (have latest_version set)
 */
export async function searchCuratedApps(
  searchTerm: string,
  // Kept for call-site compatibility; the catalog source owns client creation.
  _supabaseClient?: { from: (table: string) => unknown }
): Promise<CuratedAppMatch[]> {
  return getCatalogSource().searchCuratedAppsForMatching(searchTerm);
}

/**
 * Find best match from curated apps for a given app name
 */
export function findBestCuratedMatch(
  searchName: string,
  searchPublisher: string | null,
  curatedApps: CuratedAppMatch[]
): CuratedAppMatch | null {
  if (curatedApps.length === 0) {
    return null;
  }

  const normalizedSearch = searchName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedPublisher = searchPublisher?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';

  let bestMatch: CuratedAppMatch | null = null;
  let bestScore = 0;
  let bestIsCorroborated = false;

  for (const app of curatedApps) {
    let score = 0;
    let strongNameMatch = false;
    let publisherMatch = false;
    const normalizedName = app.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedAppPublisher = app.publisher.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Exact name match (highest priority)
    if (normalizedName === normalizedSearch) {
      score += 100;
      strongNameMatch = true;
    }
    // Name starts with search term
    else if (normalizedName.startsWith(normalizedSearch)) {
      score += 70;
      strongNameMatch = true;
    }
    // Name contains search term
    else if (normalizedName.includes(normalizedSearch)) {
      score += 50;
    }
    // Search term contains name
    else if (normalizedSearch.includes(normalizedName)) {
      score += 40;
    }

    // Publisher match
    if (normalizedPublisher && normalizedAppPublisher === normalizedPublisher) {
      score += 30;
      publisherMatch = true;
    } else if (normalizedPublisher && normalizedAppPublisher.includes(normalizedPublisher)) {
      score += 15;
      publisherMatch = true;
    }

    // Has version (verified app)
    if (app.latestVersion) {
      score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = app;
      bestIsCorroborated = strongNameMatch || publisherMatch;
    }
  }

  // Only return if confidence is high enough. A bare name-substring signal
  // (plus incidental bonuses like the version bonus) is not enough on its
  // own: require an exact/starts-with name match or publisher corroboration.
  return bestScore >= 50 && bestIsCorroborated ? bestMatch : null;
}
