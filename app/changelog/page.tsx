import { Metadata } from "next";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { T, Var } from "gt-next";

export const metadata: Metadata = {
  title: "Changelog | IntuneGet - Release History & Updates",
  description:
    "Track the latest updates, features, and improvements to IntuneGet. See what's new in the free, open-source Intune app deployment tool.",
  alternates: {
    canonical: "https://intuneget.com/changelog",
  },
  openGraph: {
    title: "IntuneGet Changelog - Release History",
    description:
      "Track the latest updates, features, and improvements to IntuneGet.",
  },
};

interface Release {
  version: string;
  date: string;
  title: string;
  highlights: string[];
  type: "major" | "minor" | "patch";
}

const releases: Release[] = [
  {
    version: "0.6.5",
    date: "2026-03-30",
    title: "App Dependencies & Supersedence, Changelog, and Bug Fixes",
    type: "minor",
    highlights: [
      "App Dependencies & Supersedence: configure dependency and supersedence relationships for Win32 apps directly in IntuneGet, applied automatically via Microsoft Graph API after deployment",
      "Changelog page redesigned with improved visual hierarchy, latest release highlighting, and GitHub-style timeline",
      "Changelog link added to landing page navbar and dashboard sidebar for easy access",
      "ESP profile error messages now show the actual Graph API error instead of a generic failure",
      "Fixed ESP profile selector readability in light mode: selected items and warning banners now display correctly",
      "ESP warning banner improved with actionable guidance when no required assignment is configured",
      "Updated Entra ID setup documentation: ESP profile support requires DeviceManagementServiceConfig.ReadWrite.All (not Read.All)",
      "Fixed React 19 compatibility: upgraded @react-three/fiber, drei, and postprocessing to versions compatible with Next.js 15 vendored React",
    ],
  },
  {
    version: "0.6.4",
    date: "2026-03-05",
    title: "Multilanguage Support, App Dependencies & Improved Search",
    type: "minor",
    highlights: [
      "Multilanguage support: auto-detect user language from browser settings with gt-next i18n across the entire app",
      "App Dependencies & Supersedence: configure dependency and supersedence relationships for Win32 apps, applied via Graph API after deployment",
      "Graph API rate limiting: automatic retry logic with token caching for 429 throttled requests",
      "Deployment warnings: display partial success scenarios when assignments or categories fail but the app deploys",
      "Search improvements: boost exact and prefix matches in full-text search ordering",
      "Unmanaged app matching: prevent false partial matches in the discovered apps matcher",
      "Preserve updateOnly assignments and requirement rules through the app update path",
      "Fix intermittent error on the Unmanaged Apps page from stale state",
      "Over 200 new app icons added via automated web icon extraction pipeline",
    ],
  },
  {
    version: "0.6.3",
    date: "2026-02-25",
    title: "Microsoft Store Apps, ESP Profiles & Language Variants",
    type: "minor",
    highlights: [
      "Microsoft Store app support: deploy Store apps directly via the Display Catalog API without packaging",
      "Enrollment Status Page (ESP) profile support: assign apps to ESP profiles during deployment",
      "Language variant support: select locale-specific WinGet package variants for multilingual deployments",
      "3D rotating package animation on the sign-in verification page",
      "Fix MSP org creator role to owner instead of default operator",
      "Fix empty client_id in Docker self-hosted MSAL authentication",
      "Show proper error state when discovered apps fail to load",
      "Strip locale tags from package names across all catalog views",
      "Remove user email exposure from app suggestions list for privacy",
      "Auto-update job cleanup and auto-dismiss from the dashboard",
      "Replace Group.Read.All with less-privileged GroupMember.Read.All",
    ],
  },
  {
    version: "0.6.2",
    date: "2026-02-16",
    title: "Package Testing Pipeline & Dashboard UX Overhaul",
    type: "minor",
    highlights: [
      "Package Testing Pipeline: every PSADT package now goes through a full install/uninstall test cycle on a Windows runner before being uploaded to Intune",
      "Real-time test progress with a 3-step sub-stepper UI (Structure Validation, Install, Uninstall) that updates live during the test phase",
      "Pre-installed app detection: automatically skips install/uninstall testing for apps already present on the runner to avoid conflicts and timeouts",
      "MSIX/AppX packages are gracefully skipped on Windows Server runners where they are not supported",
      "Structured error display for test failures with per-step results, exit codes, and duration breakdowns",
      "App Catalog, Updates, Inventory, Unmanaged Apps, and SCCM Migration pages completely redesigned with improved UX and interactions",
      "Cookie consent banner for privacy compliance with customizable preferences",
      "Handle updates for apps not originally deployed through IntuneGet",
      "Bulk Update improvements: bulk API for Update All, scoped rate limit cooldown, and progress dialog",
      "Parallel chunked uploads in GitHub Actions workflow (25MB x 4 concurrent) for faster deployment",
      "Over 7,000 app icons added via automated web icon extraction pipeline",
      "Contributor License Agreement (CLA) workflow for community contributions",
      "RealmJoin sponsor banner on the landing page hero section",
    ],
  },
  {
    version: "0.6.1",
    date: "2026-02-14",
    title: "Bug Fixes & Upload History Management",
    type: "patch",
    highlights: [
      "Auto-cleanup cron job for stuck deployment jobs (marks jobs stale after 30 minutes)",
      "MSP section now discoverable for all users with redirect to setup page",
      "Fixed team invite email mismatch using Microsoft Graph API email resolution",
      "Fixed duplicate entries on Discovered Apps page from Graph API pagination overlap",
      "Upload history management: Clear History button, individual job dismiss, and auto-cleanup of old jobs",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-02-13",
    title: "Update Only Assignments for Discovered Apps",
    type: "minor",
    highlights: [
      "New 'Update Only' assignment intent: deploy updates exclusively to devices where the app is already installed, skip devices without it",
      "Automatic requirement rule generation using standard Windows detection (uninstall registry search for all apps, direct product code check for MSI)",
      "Full pipeline support: Update Only works across web UI, local packager, and GitHub Actions deployment paths",
      "Amber-styled UI with informational banners explaining Update Only behavior and mixed-intent warnings",
      "Expanded RequirementRule types matching the Microsoft Graph API win32LobAppRule format",
      "Documentation updates across five doc pages covering configuration, troubleshooting, and Intune evaluation logic",
      "Closes Issue #13: Patch My PC-style update-only assignment support for discovered and unmanaged apps",
    ],
  },
  {
    version: "0.5.8",
    date: "2026-02-13",
    title: "Installer Filename Normalization for Workflow Packaging",
    type: "patch",
    highlights: [
      "Normalize installer filenames in GitHub Actions packaging to prevent extensionless executable paths",
      "Append deterministic extensions for extensionless installer URLs based on installer type (for example Postman windows_64 -> windows_64.exe)",
      "Add workflow resolver self-validation cases for EXE, MSI, SourceForge download paths, and ZIP artifacts",
      "Align app-side install command and upload metadata filename resolution with shared helper and test coverage",
      "Fix Issue #8: postman.postman fails to install due to extensionless installer filename",
    ],
  },
  {
    version: "0.5.6",
    date: "2026-02-12",
    title: "Intune Metadata and Workflow Payload Improvements",
    type: "patch",
    highlights: [
      "Propagate package descriptions from Supabase catalog entries into GitHub Actions upload payloads",
      "Set Intune Win32 app description from provided package metadata with safe fallback for legacy installs",
      "Preserve existing displayVersion behavior in workflow app creation payloads",
      "Close issues for architecture and catalog description handling in GitHub Actions deployment path",
    ],
  },
  {
    version: "0.5.4",
    date: "2026-02-12",
    title: "GitHub Actions Architecture Fix",
    type: "patch",
    highlights: [
      "Preserve app architecture through GitHub Actions deployment payloads",
      "Map architecture to applicableArchitectures in GA workflow Intune app creation",
      "Propagate architecture consistently in workflow reference and executable workflow",
      "Close Issue #11: fix multi-architecture deploys using ARM packages",
    ],
  },
  {
    version: "0.5.2",
    date: "2026-02-12",
    title: "Inventory Flow UX Improvement",
    type: "patch",
    highlights: [
      "Add configurable cart auto-open preference in cart state with persisted user setting",
      "Add Settings toggle to control whether the cart opens when adding a single app",
      "Respect preference across all addItem paths while keeping addItemSilent behavior unchanged",
      "Keep migration flow explicit by preserving existing openCart call after bulk add",
      "Close Issue #31: inventory multi-select claim flow no longer forces cart to open",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-02-01",
    title: "Unmanaged Apps, MSP Solution & Major Dashboard Overhaul",
    type: "minor",
    highlights: [
      "Unmanaged Apps Detection: discover apps on managed devices, match against Winget, claim individually or in bulk",
      "MSP Solution: multi-tenant batch deployments, team management (Owner/Admin/Operator/Viewer roles), cross-tenant reporting",
      "MSP Webhooks with HMAC signing, event type selection, delivery logs, and retry logic",
      "MSP Audit Logs with IP/user agent tracking and filtering",
      "MSP Reports dashboard with cross-tenant trends, success rates, and CSV/JSON/PDF export",
      "Dashboard converted to light theme with refreshed visual design",
      "Collapsible sidebar with Zustand state persistence",
      "Settings page overhaul: 5 tabs (General, Permissions, Notifications, Export, Data)",
      "Notification settings: email frequency control (real-time, digest, critical-only)",
      "Webhook integration for Slack, Microsoft Teams, Discord, and custom endpoints",
      "Sign-in page redesign with improved authentication flow",
      "Comprehensive PSADT v4 UI elements support for deployment scripts",
      "Icon extraction pipeline improvements using native Win32 API (msi.dll P/Invoke)",
      "Download timeouts to prevent pipeline stalls",
      "winget-pkgs-index v2 upgrade for faster package lookups",
      "New API permission: DeviceManagementManagedDevices.Read.All for discovered apps",
      "Inventory page enhancements: grid/list view toggle, stat cards, improved filtering",
      "License changed from MIT to AGPL-3.0",
      "New dependencies: zustand, resend, recharts, and others",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-01-15",
    title: "AI-Powered App Discovery & Bulk Operations",
    type: "minor",
    highlights: [
      "AI-powered app search and discovery from 10,000+ Winget packages",
      "Bulk deployment support for multiple apps at once",
      "Improved Entra ID authentication flow",
      "Enhanced error handling and progress tracking",
      "Added troubleshooting documentation",
    ],
  },
  {
    version: "0.3.0",
    date: "2025-12-01",
    title: "Self-Hosting & Docker Support",
    type: "minor",
    highlights: [
      "Docker support for self-hosting on your own infrastructure",
      "Comprehensive documentation for Azure setup and GitHub integration",
      "Improved application packaging pipeline",
      "Added support for custom deployment configurations",
    ],
  },
  {
    version: "0.2.0",
    date: "2025-10-15",
    title: "Winget Integration & Auto-Packaging",
    type: "minor",
    highlights: [
      "Full Winget repository integration with 10,000+ apps",
      "Automatic IntuneWin packaging without manual scripting",
      "Microsoft Entra ID authentication",
      "Real-time deployment progress tracking",
    ],
  },
  {
    version: "0.1.0",
    date: "2025-08-01",
    title: "Initial Release",
    type: "major",
    highlights: [
      "Initial release of IntuneGet",
      "Basic Winget app search and deployment to Intune",
      "Web-based dashboard interface",
      "Fully open source",
    ],
  },
];

function VersionBadge({ type, isLatest }: { type: Release["type"]; isLatest?: boolean }) {
  const styles = {
    major: "bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30",
    minor: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
    patch: "bg-overlay/[0.06] text-text-muted border border-overlay/10",
  };

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block px-2.5 py-0.5 text-xs font-medium rounded-full ${styles[type]}`}>
        <T>{type}</T>
      </span>
      {isLatest && (
        <span className="inline-block px-2.5 py-0.5 text-xs font-semibold rounded-full bg-accent-cyan text-white">
          <T>Latest</T>
        </span>
      )}
    </div>
  );
}

const changelogJsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "IntuneGet Release History",
  itemListElement: releases.map((release, index) => ({
    "@type": "ListItem",
    position: index + 1,
    item: {
      "@type": "SoftwareApplication",
      name: `IntuneGet v${release.version}`,
      softwareVersion: release.version,
      datePublished: release.date,
      description: release.title,
    },
  })),
};

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://intuneget.com",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Changelog",
      item: "https://intuneget.com/changelog",
    },
  ],
};

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-bg-deepest flex flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(changelogJsonLd) }}
      />

      <main className="flex-1 mx-auto max-w-3xl px-4 py-12 lg:px-8 lg:py-16 pt-24 lg:pt-28 w-full">
        {/* Header */}
        <div className="mb-12">
          <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
            <T>Changelog</T>
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-text-primary mb-4">
            <T>What&apos;s New in IntuneGet</T>
          </h1>
          <p className="text-lg text-text-secondary mb-6">
            <T>
              Track the latest updates, features, and improvements. IntuneGet is
              actively maintained and regularly updated with new capabilities.
            </T>
          </p>
          <div className="flex items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-2 text-text-muted">
              <span className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse" />
              <Var>{releases.length}</Var> <T>releases</T>
            </span>
            <a
              href="https://github.com/ugurkocde/IntuneGet/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-text-muted hover:text-accent-cyan transition-colors"
            >
              <T>View on GitHub</T>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>

        {/* Releases */}
        <div className="space-y-0">
          {releases.map((release, index) => {
            const isLatest = index === 0;
            return (
              <div
                key={release.version}
                className="relative pl-8 pb-10 last:pb-0"
              >
                {/* Timeline line */}
                {index < releases.length - 1 && (
                  <div className="absolute left-[11px] top-6 bottom-0 w-px bg-overlay/15" />
                )}
                {/* Timeline dot */}
                <div className={`absolute left-0 top-1.5 w-[23px] h-[23px] rounded-full border-2 ${
                  isLatest ? 'border-accent-cyan bg-accent-cyan/10' : 'border-overlay/20 bg-bg-elevated'
                } flex items-center justify-center`}>
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    isLatest ? 'bg-accent-cyan' : 'bg-overlay/30'
                  }`} />
                </div>

                {/* Content */}
                <div className={`rounded-xl border p-6 transition-colors ${
                  isLatest
                    ? 'bg-bg-elevated border-accent-cyan/20 shadow-soft-md'
                    : 'bg-bg-elevated/70 border-overlay/10 shadow-soft'
                }`}>
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <span className={`font-mono text-lg font-bold ${
                      isLatest ? 'text-accent-cyan' : 'text-text-primary'
                    }`}>
                      v<Var>{release.version}</Var>
                    </span>
                    <VersionBadge type={release.type} isLatest={isLatest} />
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <time className="text-xs text-text-muted font-mono">
                      <Var>{release.date}</Var>
                    </time>
                  </div>
                  <h2 className="text-lg font-semibold text-text-primary mb-4">
                    <T>{release.title}</T>
                  </h2>
                  <ul className="space-y-2.5">
                    {release.highlights.map((highlight) => (
                      <li
                        key={highlight}
                        className="flex items-start gap-2.5 text-sm text-text-secondary leading-relaxed"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${
                          isLatest ? 'bg-accent-cyan' : 'bg-overlay/30'
                        }`} />
                        <T>{highlight}</T>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer CTA */}
        <div className="mt-16 rounded-xl border border-overlay/10 bg-bg-elevated/50 p-8 text-center">
          <p className="text-text-secondary text-sm mb-3">
            <T>Want to see the full commit history?</T>
          </p>
          <a
            href="https://github.com/ugurkocde/IntuneGet/commits"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-overlay/15 bg-bg-elevated text-text-primary text-sm font-medium hover:border-accent-cyan/30 hover:text-accent-cyan transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            <T>View on GitHub</T>
          </a>
        </div>
      </main>

      <Footer />
    </div>
  );
}
