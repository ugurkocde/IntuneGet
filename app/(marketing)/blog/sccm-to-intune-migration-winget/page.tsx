import { Metadata } from "next";
import Link from "next/link";
import { getBlogPost } from "@/lib/data/blog-data";
import { BlogPostHeader } from "@/components/blog/BlogPostHeader";
import { BlogTableOfContents } from "@/components/blog/BlogTableOfContents";
import { BlogAuthorCard } from "@/components/blog/BlogAuthorCard";
import { RelatedPosts } from "@/components/blog/RelatedPosts";
import { blogPosts } from "@/lib/data/blog-data";
import { ArrowRight } from "lucide-react";
import { T } from "gt-next";

const post = getBlogPost("sccm-to-intune-migration-winget")!;

export const metadata: Metadata = {
  title: post.title,
  description: post.description,
  alternates: {
    canonical: "https://intuneget.com/blog/sccm-to-intune-migration-winget",
  },
  openGraph: {
    title: post.title,
    description: post.description,
    url: "https://intuneget.com/blog/sccm-to-intune-migration-winget",
    type: "article",
    publishedTime: post.date,
    authors: [post.author],
    tags: post.tags,
  },
  twitter: {
    card: "summary_large_image",
    title: post.title,
    description: post.description,
  },
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
      name: "Blog",
      item: "https://intuneget.com/blog",
    },
    {
      "@type": "ListItem",
      position: 3,
      name: post.title,
      item: "https://intuneget.com/blog/sccm-to-intune-migration-winget",
    },
  ],
};

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline: post.title,
  description: post.description,
  datePublished: post.date,
  dateModified: post.date,
  author: {
    "@type": "Person",
    name: "Ugur Koc",
    url: "https://github.com/ugurkocde",
    jobTitle: "Microsoft MVP",
    sameAs: [
      "https://github.com/ugurkocde",
      "https://www.linkedin.com/in/ugurkocde/",
    ],
  },
  publisher: {
    "@type": "Organization",
    name: "IntuneGet",
    url: "https://intuneget.com",
  },
  image: "https://intuneget.com/favicon.svg",
  mainEntityOfPage:
    "https://intuneget.com/blog/sccm-to-intune-migration-winget",
  keywords: [
    "SCCM to Intune migration",
    "MECM to Intune",
    "Winget app re-packaging",
    "SCCM app migration",
    "IntuneGet",
    "Intune app deployment",
    "co-management",
    "endpoint management migration",
  ],
  proficiencyLevel: "Intermediate",
  dependencies:
    "Microsoft Intune license, Azure AD tenant, existing SCCM/MECM infrastructure",
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "How long does an SCCM to Intune migration typically take?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The timeline depends on your organization's size and app catalog complexity. Small environments with 20-50 applications can typically complete migration in 4-8 weeks. Mid-size organizations with 100-300 applications should plan for 3-6 months. Enterprise environments with 500+ applications may need 6-12 months. Using Winget and IntuneGet to automate app re-packaging can reduce the application migration portion by 60-80 percent compared to manual re-packaging.",
      },
    },
    {
      "@type": "Question",
      name: "Can I run SCCM and Intune at the same time during migration?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Microsoft supports co-management, which allows SCCM (MECM) and Intune to manage devices simultaneously. You can gradually shift workloads from SCCM to Intune one at a time, including client apps, compliance policies, device configuration, and Windows updates. This phased approach reduces risk and gives your team time to validate each workload before fully transitioning.",
      },
    },
    {
      "@type": "Question",
      name: "What happens to SCCM applications that are not available in Winget?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Applications not available in the Winget repository need to be packaged manually as Win32 apps for Intune. This includes custom line-of-business applications, vendor-specific installers with proprietary formats, and internally developed tools. You can use the Microsoft Win32 Content Prep Tool to create .intunewin packages from these installers. For applications distributed as MSI or MSIX, Intune also supports direct upload of those formats without Win32 wrapping.",
      },
    },
    {
      "@type": "Question",
      name: "Do I need to re-create detection rules when moving apps from SCCM to Intune?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. SCCM and Intune use different detection rule formats. SCCM detection methods such as WMI queries, custom scripts, and registry-based rules need to be translated into Intune-compatible detection rules. Intune supports MSI product code detection, file or folder existence checks, and registry key or value detection. IntuneGet automatically generates detection rules for Winget-sourced apps, eliminating manual configuration for those applications.",
      },
    },
    {
      "@type": "Question",
      name: "Is IntuneGet free for SCCM to Intune migration?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. IntuneGet is completely free and open source under the MIT license. There are no seat limits, no per-device fees, and no premium tiers. You can use it to migrate and deploy as many Winget-available applications to Intune as needed at zero cost. This makes it particularly valuable for large-scale SCCM migrations where re-packaging hundreds of applications manually would require significant time investment.",
      },
    },
  ],
};

const tocItems = [
  {
    id: "migration-challenge",
    title: "The SCCM to Intune App Migration Challenge",
    level: 2,
  },
  {
    id: "why-winget-simplifies",
    title: "Why Winget Simplifies SCCM to Intune Migration",
    level: 2,
  },
  { id: "step-by-step", title: "Step-by-Step Migration Process", level: 2 },
  {
    id: "using-intuneget-migration",
    title: "Using IntuneGet for Bulk App Migration",
    level: 2,
  },
  {
    id: "apps-not-in-winget",
    title: "Handling Apps Not in Winget",
    level: 2,
  },
  { id: "co-management", title: "Co-management Considerations", level: 2 },
  { id: "faq", title: "Frequently Asked Questions", level: 2 },
  { id: "conclusion", title: "Conclusion", level: 2 },
];

export default function SccmToIntuneMigrationWingetPage() {
  const jsonLdScripts = [breadcrumbJsonLd, articleJsonLd, faqJsonLd];

  return (
    <>
      {jsonLdScripts.map((data, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
      ))}

      <div className="container px-4 md:px-6 mx-auto max-w-7xl py-8 md:py-12">
        <div className="flex gap-12">
          {/* Main content */}
          <article className="flex-1 min-w-0 max-w-3xl">
            <BlogPostHeader
              title={post.title}
              date={post.date}
              author={post.author}
              authorRole={post.authorRole}
              readTime={post.readTime}
              tags={post.tags}
            />

            <div className="prose prose-invert prose-stone max-w-none">
              {/* Introduction */}
              <p className="text-lg text-text-secondary leading-relaxed">
                <T>Organizations across every industry are shifting from System
                Center Configuration Manager (SCCM) -- now Microsoft Endpoint
                Configuration Manager (MECM) -- to Microsoft Intune for endpoint
                management. The move to cloud-native device management brings
                real advantages: no on-premises infrastructure to maintain,
                native support for remote and hybrid workforces, and tighter
                integration with the Microsoft 365 ecosystem. But there is one
                part of the migration that consistently causes IT teams to stall:
                the application catalog.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>Your SCCM environment likely has dozens or hundreds of
                applications configured with specific deployment types, detection
                methods, requirement rules, and dependencies. None of that
                configuration transfers directly to Intune. Every application
                needs to be re-evaluated, re-packaged, and re-deployed. This
                guide walks through how to use the Windows Package Manager
                (Winget) and{" "}
                <Link href="/" className="text-accent-cyan hover:underline">
                  IntuneGet
                </Link>{" "}
                to dramatically accelerate the app migration portion of your SCCM
                to Intune transition, turning weeks of manual re-packaging work
                into a streamlined, largely automated process.</T>
              </p>

              {/* The SCCM to Intune App Migration Challenge */}
              <h2
                id="migration-challenge"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>The SCCM to Intune App Migration Challenge</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>SCCM and Intune handle application management in fundamentally
                different ways. Understanding these differences is the first step
                toward planning an efficient migration. In SCCM, applications are
                built around deployment types that define how an app is installed
                on different platforms and architectures. A single SCCM
                application might have multiple deployment types for x86 and x64
                systems, each with its own installer, detection method, and
                requirements. Intune uses a flatter model where each Win32 app is
                a single entity with one installer package, one set of detection
                rules, and one set of requirement rules.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>The practical impact is significant. Here is what you face when
                migrating your SCCM app catalog to Intune:</T>
              </p>
              <ul className="space-y-3 text-text-secondary">
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Format incompatibility:
                    </strong>{" "}
                    SCCM applications use source files directly from network
                    shares. Intune Win32 apps require everything wrapped in the{" "}
                    <code>.intunewin</code> format using the Microsoft Win32
                    Content Prep Tool. Every application needs re-packaging.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Detection rule translation:
                    </strong>{" "}
                    SCCM detection methods (WMI queries, complex script-based
                    detection, enhanced detection with clauses) need to be
                    rebuilt as Intune detection rules. Intune supports MSI
                    product codes, file or folder checks, and registry key
                    detection, but not the same flexible WMI and scripting
                    options SCCM offers.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Installer sourcing:
                    </strong>{" "}
                    Many SCCM deployments reference installers on internal
                    distribution points or file shares. Moving to Intune means
                    you need current installer files uploaded to the Intune
                    service. If your SCCM source files are outdated, you need to
                    re-download current versions from vendors.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Dependency and supersedence gaps:
                    </strong>{" "}
                    SCCM supports complex dependency chains and supersedence
                    relationships between applications. Intune has more limited
                    dependency support and handles supersedence differently.
                    These relationships need to be reviewed and restructured.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Scale of effort:
                    </strong>{" "}
                    A typical enterprise SCCM environment has 100-500
                    applications. At 1-2 hours per application for manual
                    re-packaging, you are looking at 200-1,000 hours of work
                    just for the app catalog -- before testing.</T>
                  </span>
                </li>
              </ul>

              {/* Why Winget Simplifies SCCM to Intune Migration */}
              <h2
                id="why-winget-simplifies"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Why Winget Simplifies SCCM to Intune Migration</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>The Windows Package Manager (Winget) changes the economics of
                SCCM to Intune app migration. Instead of manually downloading
                installers from vendor websites, creating IntuneWin packages, and
                writing detection rules for each application, Winget provides a
                standardized catalog of over 13,000 applications with verified
                installers, version metadata, and hash validation. The key
                insight is that a large percentage of your SCCM app catalog
                likely consists of common third-party applications that already
                exist in the Winget repository.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>Consider a typical SCCM application catalog. Common applications
                like Google Chrome, Mozilla Firefox, Adobe Reader, 7-Zip, Visual
                Studio Code, Notepad++, VLC Media Player, Zoom, and Microsoft
                Teams are present in nearly every enterprise environment. All of
                these are available in Winget with standardized package
                manifests that include the exact information needed for Intune
                deployment: installer URLs, silent install switches, detection
                data, and publisher metadata.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>Here is why Winget makes SCCM to Intune migration faster:</T>
              </p>
              <ul className="space-y-3 text-text-secondary">
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Instant installer sourcing:
                    </strong>{" "}
                    No need to hunt for download links or verify file integrity.
                    Winget provides verified installers with SHA256 hashes for
                    every package version.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Pre-built metadata:
                    </strong>{" "}
                    Winget manifests include installer type (MSI, EXE, MSIX),
                    silent install flags, publisher info, and architecture
                    details. This is precisely the data you need to configure
                    Intune Win32 apps.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Consistent packaging:
                    </strong>{" "}
                    Every Winget package follows the same manifest schema. Once
                    you have a workflow for converting Winget packages to Intune
                    apps, it works the same way for all 13,000+ packages.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Version management:
                    </strong>{" "}
                    Winget tracks every published version, making it
                    straightforward to deploy the same version you had in SCCM or
                    upgrade to the latest release as part of the migration.</T>
                  </span>
                </li>
              </ul>

              {/* Step-by-Step Migration Process */}
              <h2
                id="step-by-step"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Step-by-Step Migration Process</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>The following process outlines how to systematically migrate your
                SCCM application catalog to Intune using Winget as the
                intermediary. This approach splits your catalog into two
                categories: apps that have Winget equivalents (which can be
                automated) and apps that require manual re-packaging.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Step 1: Export your SCCM application inventory</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Start by generating a complete list of applications currently
                deployed through SCCM. Connect to your SCCM site server and run
                the following PowerShell commands to export your application
                catalog:</T>
              </p>
              <div className="bg-bg-surface rounded-xl border border-overlay/10 p-4 my-4 overflow-x-auto">
                <pre className="text-sm text-text-secondary font-mono">
                  <code>{`# Connect to your SCCM site
Import-Module ConfigurationManager
Set-Location "$((Get-PSDrive -PSProvider CMSite).Name):"

# Export all applications with deployment type details
Get-CMApplication | Select-Object LocalizedDisplayName, SoftwareVersion, \`
  Manufacturer, NumberOfDeploymentTypes, IsDeployed, IsSuperseded |
  Sort-Object LocalizedDisplayName |
  Export-Csv -Path "C:\\Migration\\SCCM_AppCatalog.csv" -NoTypeInformation

# Get deployment type details for detection rule reference
Get-CMApplication | ForEach-Object {
  $app = $_
  Get-CMDeploymentType -ApplicationName $app.LocalizedDisplayName |
    Select-Object @{N='Application';E={$app.LocalizedDisplayName}},
      LocalizedDisplayName, Technology, ContentLocation
} | Export-Csv -Path "C:\\Migration\\SCCM_DeploymentTypes.csv" -NoTypeInformation

Write-Host "Exported application catalog to C:\\Migration\\"`}</code>
                </pre>
              </div>
              <p className="text-text-secondary leading-relaxed">
                <T>This gives you a comprehensive list of every application in SCCM
                along with its deployment type technology (MSI, Script, AppV,
                etc.) and content source location. Keep this export as your
                migration tracking document.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Step 2: Match SCCM apps to Winget packages</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>With your SCCM app list in hand, the next step is identifying
                which applications have Winget equivalents. You can automate this
                matching process with PowerShell:</T>
              </p>
              <div className="bg-bg-surface rounded-xl border border-overlay/10 p-4 my-4 overflow-x-auto">
                <pre className="text-sm text-text-secondary font-mono">
                  <code>{`# Read the exported SCCM app list
$sccmApps = Import-Csv "C:\\Migration\\SCCM_AppCatalog.csv"

# Search Winget for each SCCM application
$results = foreach ($app in $sccmApps) {
  $searchTerm = $app.LocalizedDisplayName
  $wingetResult = winget search $searchTerm --accept-source-agreements 2>$null |
    Select-String -Pattern "^\\S+" | Select-Object -Skip 1 -First 1

  [PSCustomObject]@{
    SCCMAppName    = $app.LocalizedDisplayName
    SCCMVersion    = $app.SoftwareVersion
    Publisher      = $app.Manufacturer
    WingetMatch    = if ($wingetResult) { "Found" } else { "Not Found" }
    WingetOutput   = if ($wingetResult) { $wingetResult.Line.Trim() } else { "N/A" }
  }
}

# Export results and display summary
$results | Export-Csv "C:\\Migration\\WingetMatchResults.csv" -NoTypeInformation

$found = ($results | Where-Object WingetMatch -eq "Found").Count
$total = $results.Count
Write-Host "Winget matches: $found / $total applications ($([math]::Round($found/$total*100))%)"
Write-Host "Results saved to C:\\Migration\\WingetMatchResults.csv"`}</code>
                </pre>
              </div>
              <p className="text-text-secondary leading-relaxed">
                <T>In most enterprise environments, 40-70 percent of third-party
                applications will have Winget matches. The exact percentage
                depends on how many custom line-of-business apps you have in your
                catalog. Common commercial and open-source applications almost
                always have Winget packages.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Step 3: Deploy matched apps to Intune with IntuneGet</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>For every application that has a Winget match, you can use{" "}
                <Link href="/" className="text-accent-cyan hover:underline">
                  IntuneGet
                </Link>{" "}
                to deploy it to Intune in minutes instead of hours. Sign in to
                IntuneGet with your Microsoft Entra ID account, search for the
                application by name, and deploy it. IntuneGet handles the
                complete pipeline: downloading the installer from Winget,
                creating the <code>.intunewin</code> package, generating
                detection rules based on the installer type, configuring install
                and uninstall commands, and uploading the finished package to
                your Intune tenant via the Graph API.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Step 4: Verify and assign</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>After deploying apps through IntuneGet, verify each application
                in the Intune admin center. Check that detection rules, install
                commands, and requirement rules are correctly configured. Then
                assign the applications to the same user or device groups that
                received the apps through SCCM. Run pilot deployments to a test
                group before rolling out to production to validate that
                applications install and detect correctly in the Intune-managed
                context.</T>
              </p>

              {/* Using IntuneGet for Bulk App Migration */}
              <h2
                id="using-intuneget-migration"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Using IntuneGet for Bulk App Migration</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>The real value of IntuneGet becomes apparent at scale. Manually
                re-packaging 100 applications at 1-2 hours each means 100-200
                hours of work. With IntuneGet, those same 100 applications (assuming
                they have Winget equivalents) can be deployed in approximately 8-10
                hours, including time for review and validation. That is an 80-90
                percent reduction in effort for the application migration portion
                of your SCCM to Intune project.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>IntuneGet provides several capabilities that are particularly
                useful during large-scale SCCM migrations:</T>
              </p>
              <ul className="space-y-3 text-text-secondary">
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Full Winget catalog access:
                    </strong>{" "}
                    Search and deploy from the complete Winget repository of
                    13,000+ packages, unlike the limited subset available in
                    Intune&apos;s built-in Winget catalog.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Automatic detection rules:
                    </strong>{" "}
                    IntuneGet reads the Winget manifest to determine the
                    installer type and generates the appropriate detection rule
                    automatically -- MSI product code for MSI installers, file
                    detection for EXE-based apps.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Pre-upload permission validation:
                    </strong>{" "}
                    Before starting any deployment, IntuneGet verifies your Graph
                    API permissions. This prevents the frustration of packaging
                    an application only to discover you lack the required
                    DeviceManagementApps.ReadWrite.All permission.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Post-migration update management:
                    </strong>{" "}
                    Once your apps are in Intune, IntuneGet monitors Winget for
                    new versions and can automatically update your deployments.
                    Configure per-app policies for auto-update, notify-only,
                    version pinning, or ignore.</T>
                  </span>
                </li>
              </ul>
              <p className="text-text-secondary leading-relaxed">
                <T>To get started, see the{" "}
                <Link
                  href="/docs/getting-started"
                  className="text-accent-cyan hover:underline"
                >
                  Getting Started guide
                </Link>{" "}
                for initial setup, or jump directly to the{" "}
                <Link
                  href="/docs/sccm-migration"
                  className="text-accent-cyan hover:underline"
                >
                  SCCM Migration guide
                </Link>{" "}
                for a walkthrough tailored to organizations moving from SCCM to
                Intune. You can{" "}
                <Link
                  href="/auth/signin"
                  className="text-accent-cyan hover:underline"
                >
                  sign in and start deploying
                </Link>{" "}
                immediately -- IntuneGet is free and open source under the MIT
                license with no seat limits or usage restrictions.</T>
              </p>

              {/* Handling Apps Not in Winget */}
              <h2
                id="apps-not-in-winget"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Handling Apps Not in Winget</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>Not every application in your SCCM catalog will have a Winget
                equivalent. Custom line-of-business applications, vendor-specific
                enterprise software with proprietary licensing, and internally
                developed tools will need a different approach. Here are
                strategies for handling these apps:</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Custom line-of-business applications</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>LOB apps built internally or customized for your organization
                will need manual packaging. Locate the source installer from your
                SCCM content library or internal build pipeline. Use the
                Microsoft Win32 Content Prep Tool to create the{" "}
                <code>.intunewin</code> package, then upload it to Intune
                manually. Pay close attention to detection rules -- if your SCCM
                detection method used a WMI query, you will need to translate
                that into a registry check or file existence rule that Intune
                supports.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Vendor-specific enterprise packages</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Some enterprise applications -- particularly those with complex
                licensing, hardware dongles, or custom middleware dependencies --
                are distributed through vendor-specific channels and are not
                available in Winget. For these applications, contact the vendor
                for an Intune-compatible installer or deployment guide. Many
                enterprise software vendors have updated their deployment
                documentation to include Intune-specific instructions as more
                organizations migrate from SCCM. If the vendor provides an MSI
                installer, Intune can deploy it directly without Win32 wrapping.
                MSIX-packaged applications are also natively supported in Intune.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Scripts and configuration packages</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>SCCM environments often include script-based packages for
                configuration tasks, printer deployments, drive mappings, and
                system tweaks. These do not translate to Intune Win32 apps.
                Instead, evaluate whether these tasks should move to Intune
                device configuration profiles, PowerShell scripts deployed
                through Intune, remediation scripts, or Proactive Remediations.
                This is an opportunity to modernize legacy scripted
                configurations into proper policy-based management.</T>
              </p>

              {/* Co-management Considerations */}
              <h2
                id="co-management"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Co-management Considerations</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>Most organizations do not migrate from SCCM to Intune overnight.
                Microsoft&apos;s co-management feature allows you to run both
                systems in parallel, gradually shifting workloads from SCCM to
                Intune. Understanding how co-management affects application
                deployment is critical for a smooth migration.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>Co-management lets you switch individual workloads between SCCM
                and Intune independently. The workloads that affect application
                migration directly are:</T>
              </p>
              <ul className="space-y-3 text-text-secondary">
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Client apps workload:
                    </strong>{" "}
                    Controls which system manages application deployments. When
                    set to Intune, the Company Portal becomes the primary app
                    catalog for users. Keep this on SCCM until you have migrated
                    a critical mass of applications to Intune.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Compliance policies workload:
                    </strong>{" "}
                    If your compliance policies reference specific application
                    installations as requirements, ensure those applications are
                    available through Intune before switching this workload.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">
                      Windows Update policies workload:
                    </strong>{" "}
                    Independent of application deployment, but worth migrating
                    early since Intune&apos;s Windows Update for Business
                    policies offer more granular control than SCCM&apos;s
                    software update point for most scenarios.</T>
                  </span>
                </li>
              </ul>
              <p className="text-text-secondary leading-relaxed">
                <T>A recommended co-management migration sequence for applications:</T>
              </p>
              <ol className="space-y-2 text-text-secondary list-decimal list-inside">
                <li><T>Enable co-management and keep all workloads on SCCM initially</T></li>
                <li><T>Begin deploying new applications through Intune only (do not
                  add new apps to SCCM)</T></li>
                <li><T>Use IntuneGet and Winget to migrate existing SCCM apps to
                  Intune in batches</T></li>
                <li><T>Run parallel deployments for critical apps -- deploy through
                  both SCCM and Intune during the validation period</T></li>
                <li><T>Switch the Client Apps workload to a pilot Intune group for
                  testing</T></li>
                <li><T>After successful validation, switch the Client Apps workload to
                  Intune for all devices</T></li>
                <li><T>Retire the corresponding SCCM applications once Intune
                  deployments are confirmed working</T></li>
              </ol>
              <p className="text-text-secondary leading-relaxed mt-4">
                <T>During the co-management phase, avoid deploying the same
                application through both SCCM and Intune to the same device
                unless you are intentionally running parallel validation. Dual
                management of the same app can cause detection conflicts and
                unexpected installation or removal behavior.</T>
              </p>

              {/* FAQ */}
              <h2
                id="faq"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Frequently Asked Questions</T>
              </h2>

              <div className="space-y-6 mt-6">
                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>How long does an SCCM to Intune migration typically take?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>The timeline depends on your organization&apos;s size and app
                    catalog complexity. Small environments with 20-50
                    applications can typically complete migration in 4-8 weeks.
                    Mid-size organizations with 100-300 applications should plan
                    for 3-6 months. Enterprise environments with 500+
                    applications may need 6-12 months. Using Winget and IntuneGet
                    to automate app re-packaging can reduce the application
                    migration portion by 60-80 percent compared to manual
                    re-packaging.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>Can I run SCCM and Intune at the same time during migration?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>Yes. Microsoft supports co-management, which allows SCCM
                    (MECM) and Intune to manage devices simultaneously. You can
                    gradually shift workloads from SCCM to Intune one at a time,
                    including client apps, compliance policies, device
                    configuration, and Windows updates. This phased approach
                    reduces risk and gives your team time to validate each
                    workload before fully transitioning.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>What happens to SCCM applications that are not available in
                    Winget?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>Applications not available in the Winget repository need to
                    be packaged manually as Win32 apps for Intune. This includes
                    custom line-of-business applications, vendor-specific
                    installers with proprietary formats, and internally developed
                    tools. You can use the Microsoft Win32 Content Prep Tool to
                    create <code>.intunewin</code> packages from these
                    installers. For applications distributed as MSI or MSIX,
                    Intune also supports direct upload of those formats without
                    Win32 wrapping.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>Do I need to re-create detection rules when moving apps from
                    SCCM to Intune?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>Yes. SCCM and Intune use different detection rule formats.
                    SCCM detection methods such as WMI queries, custom scripts,
                    and registry-based rules need to be translated into
                    Intune-compatible detection rules. Intune supports MSI
                    product code detection, file or folder existence checks, and
                    registry key or value detection. IntuneGet automatically
                    generates detection rules for Winget-sourced apps,
                    eliminating manual configuration for those applications.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>Is IntuneGet free for SCCM to Intune migration?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>Yes. IntuneGet is completely free and open source under the
                    MIT license. There are no seat limits, no per-device fees,
                    and no premium tiers. You can use it to migrate and deploy as
                    many Winget-available applications to Intune as needed at
                    zero cost. This makes it particularly valuable for
                    large-scale SCCM migrations where re-packaging hundreds of
                    applications manually would require significant time
                    investment.</T>
                  </p>
                </div>
              </div>

              {/* Conclusion */}
              <h2
                id="conclusion"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Conclusion</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>Migrating from SCCM to Intune is a significant undertaking, but
                the application catalog does not have to be the bottleneck.
                Winget provides the standardized package repository that bridges
                the gap between SCCM&apos;s on-premises application model and
                Intune&apos;s cloud-native deployment approach. By auditing your
                SCCM catalog, identifying Winget equivalents, and using IntuneGet
                to automate the re-packaging and deployment process, you can
                reduce the app migration effort by 60-80 percent.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>For the applications that fall outside Winget&apos;s catalog,
                manual packaging remains necessary, but these represent the
                minority of most app catalogs. Combined with a well-planned
                co-management strategy that gradually shifts workloads from SCCM
                to Intune, you can execute the migration with minimal disruption
                to your end users and IT operations.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>The move to cloud-native endpoint management is not a question of
                if but when. Tools like Winget and IntuneGet exist to make that
                transition as efficient as possible, letting your team focus on
                strategic improvements rather than repetitive packaging work. For a
                step-by-step walkthrough of deploying Winget apps to Intune, see
                our{" "}
                <Link href="/blog/deploy-winget-apps-to-intune" className="text-accent-cyan hover:underline">
                  complete deployment guide
                </Link>
                . To understand the time savings automation brings versus manual
                processes, read our{" "}
                <Link href="/blog/winget-vs-manual-intune-deployment" className="text-accent-cyan hover:underline">
                  Winget vs manual deployment comparison
                </Link>
                .</T>
              </p>

              {/* CTA */}
              <div className="mt-10 p-6 rounded-2xl bg-accent-cyan/5 border border-accent-cyan/20">
                <h3 className="text-xl font-bold text-text-primary mb-3">
                  <T>Accelerate your SCCM to Intune migration</T>
                </h3>
                <p className="text-text-secondary mb-4">
                  <T>Start migrating your SCCM app catalog to Intune today.
                  IntuneGet automates Winget app re-packaging and deployment --
                  free, open source, no seat limits.</T>
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/auth/signin"
                    className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-accent-cyan rounded-xl hover:bg-accent-cyan-dim transition-colors"
                  >
                    <T>Start Free Migration</T>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                  <Link
                    href="/docs/sccm-migration"
                    className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-text-secondary bg-bg-elevated border border-overlay/10 rounded-xl hover:bg-overlay/[0.04] transition-colors"
                  >
                    <T>Read the SCCM Migration Guide</T>
                  </Link>
                </div>
              </div>
            </div>

            <BlogAuthorCard />

            <RelatedPosts
              posts={blogPosts.filter(
                (p) => p.slug !== "sccm-to-intune-migration-winget"
              )}
            />
          </article>

          {/* Sidebar TOC */}
          <aside className="w-56 flex-shrink-0 hidden xl:block">
            <BlogTableOfContents items={tocItems} />
          </aside>
        </div>
      </div>
    </>
  );
}
