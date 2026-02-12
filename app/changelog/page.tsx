import { Metadata } from "next";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";

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

function VersionBadge({ type }: { type: Release["type"] }) {
  const styles = {
    major: "bg-accent-cyan/10 text-accent-cyan",
    minor: "bg-emerald-500/10 text-emerald-600",
    patch: "bg-stone-100 text-stone-600",
  };

  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${styles[type]}`}>
      {type}
    </span>
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
            Changelog
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-stone-900 mb-4">
            What&apos;s New in IntuneGet
          </h1>
          <p className="text-lg text-stone-600">
            Track the latest updates, features, and improvements. IntuneGet is
            actively maintained and regularly updated with new capabilities.
          </p>
        </div>

        {/* Releases */}
        <div className="space-y-0">
          {releases.map((release, index) => (
            <div
              key={release.version}
              className="relative pl-8 pb-12 last:pb-0"
            >
              {/* Timeline line */}
              {index < releases.length - 1 && (
                <div className="absolute left-[11px] top-6 bottom-0 w-px bg-stone-200" />
              )}
              {/* Timeline dot */}
              <div className="absolute left-0 top-1.5 w-[23px] h-[23px] rounded-full border-2 border-accent-cyan/40 bg-white flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-accent-cyan" />
              </div>

              {/* Content */}
              <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-soft">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <span className="font-mono text-lg font-bold text-stone-900">
                    v{release.version}
                  </span>
                  <VersionBadge type={release.type} />
                  <span className="text-sm text-stone-400">{release.date}</span>
                </div>
                <h2 className="text-lg font-semibold text-stone-800 mb-3">
                  {release.title}
                </h2>
                <ul className="space-y-2">
                  {release.highlights.map((highlight) => (
                    <li
                      key={highlight}
                      className="flex items-start gap-2 text-sm text-stone-600"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-1.5 flex-shrink-0" />
                      {highlight}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* Footer CTA */}
        <div className="mt-12 text-center">
          <p className="text-stone-500 text-sm">
            View the full commit history on{" "}
            <a
              href="https://github.com/ugurkocde/IntuneGet/commits"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-cyan hover:text-accent-cyan-dim transition-colors"
            >
              GitHub
            </a>
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
