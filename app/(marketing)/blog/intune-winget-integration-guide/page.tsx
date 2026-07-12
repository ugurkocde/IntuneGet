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

const post = getBlogPost("intune-winget-integration-guide")!;

export const metadata: Metadata = {
  title: post.title,
  description: post.description,
  alternates: {
    canonical: "https://intuneget.com/blog/intune-winget-integration-guide",
  },
  openGraph: {
    title: post.title,
    description: post.description,
    url: "https://intuneget.com/blog/intune-winget-integration-guide",
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
      item: "https://intuneget.com/blog/intune-winget-integration-guide",
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
    "https://intuneget.com/blog/intune-winget-integration-guide",
  keywords: [
    "Intune Winget integration",
    "Winget Intune",
    "Microsoft Intune Winget",
    "Winget package manager Intune",
    "IntuneGet",
    "Intune app management",
  ],
  proficiencyLevel: "Intermediate",
  dependencies: "Microsoft Intune license, Azure AD tenant",
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Does Intune natively support Winget?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, Microsoft has added native Winget support to Intune through the Windows package manager app type. However, the built-in catalog only exposes a subset of the full Winget repository and offers limited control over packaging, detection rules, and update policies compared to tools like IntuneGet.",
      },
    },
    {
      "@type": "Question",
      name: "What is the difference between Winget apps and Win32 apps in Intune?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Winget apps in Intune are deployed using the Windows Package Manager client on the endpoint device. Win32 apps use the .intunewin format and are managed entirely through the Intune management extension. Win32 apps give you more control over detection rules, requirement rules, and dependencies. IntuneGet bridges both approaches by sourcing apps from Winget and packaging them as Win32 apps for full Intune management capabilities.",
      },
    },
    {
      "@type": "Question",
      name: "Can I use Winget to update apps already deployed through Intune?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "If the apps were deployed as Winget app types, Intune can leverage Winget for updates. For Win32 apps, you need to create a new app version in Intune with the updated installer. IntuneGet automates this process by monitoring the Winget repository for version changes and offering configurable update policies including auto-update, notify-only, and version pinning.",
      },
    },
    {
      "@type": "Question",
      name: "Do endpoints need Winget installed for Intune Winget integration?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "It depends on the deployment method. If you use Intune's native Winget app type, endpoints must have the Winget client (App Installer) present. If you use IntuneGet to package Winget apps as Win32 .intunewin files, endpoints do not need Winget installed because the installer is bundled in the package.",
      },
    },
    {
      "@type": "Question",
      name: "How many apps are available in the Intune Winget catalog vs the full Winget repository?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The full Winget repository contains over 13,000 application packages. Intune's built-in Winget catalog exposes a curated subset of these packages. IntuneGet provides access to the entire Winget repository, allowing IT admins to deploy any package available in Winget to Intune as a fully managed Win32 application.",
      },
    },
  ],
};

const tocItems = [
  { id: "understanding-winget", title: "Understanding the Winget Package Manager", level: 2 },
  { id: "how-winget-intune-connect", title: "How Winget and Intune Connect", level: 2 },
  { id: "native-intune-winget", title: "Native Intune Winget Support", level: 2 },
  { id: "using-intuneget", title: "Using IntuneGet for Full Winget Integration", level: 2 },
  { id: "best-practices", title: "Best Practices for Winget to Intune Deployment", level: 2 },
  { id: "limitations", title: "Winget Intune Integration Limitations to Know", level: 2 },
  { id: "faq", title: "Frequently Asked Questions", level: 2 },
  { id: "conclusion", title: "Conclusion", level: 2 },
];

export default function IntuneWingetIntegrationGuidePage() {
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
                <T>The integration between Microsoft Intune and the Windows Package
                Manager (Winget) represents one of the most significant shifts in
                how IT administrators manage application deployments across
                enterprise endpoints. For years, getting applications into Intune
                meant downloading installers from vendor websites, manually
                creating IntuneWin packages, writing detection rules by hand, and
                repeating the entire process every time a new version shipped.
                Winget changes the equation by providing a standardized, version-tracked
                repository of over 13,000 applications -- but understanding exactly
                how this integration works, where it falls short, and how to get
                the most out of it requires a deeper look at the architecture and
                tooling involved.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>This guide covers the complete picture of the Intune Winget
                integration: how the Windows Package Manager works under the hood,
                the different ways Winget connects to Intune, what Microsoft&apos;s
                native support looks like in practice, and how tools like{" "}
                <Link href="/" className="text-accent-cyan hover:underline">
                  IntuneGet
                </Link>{" "}
                extend that integration to cover the full Winget repository with
                automated packaging and deployment. Whether you are evaluating
                Winget for the first time or looking to optimize an existing
                Intune app management workflow, this guide will give you the
                technical grounding to make informed decisions.</T>
              </p>

              {/* Understanding the Winget Package Manager */}
              <h2
                id="understanding-winget"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Understanding the Winget Package Manager</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>The Windows Package Manager, known as Winget, is Microsoft&apos;s
                official command-line tool for discovering, installing, upgrading,
                and removing applications on Windows 10 and Windows 11 devices.
                It shipped as part of the App Installer package from the
                Microsoft Store and has been included by default on Windows 11
                since launch. Winget brings the same package management paradigm
                that Linux administrators have relied on for decades --
                centralized repositories, dependency resolution, and scriptable
                installation -- to the Windows ecosystem.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>The Winget repository</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>At the core of Winget is the{" "}
                <a
                  href="https://github.com/microsoft/winget-pkgs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:underline"
                >
                  winget-pkgs repository
                </a>
                , a community-maintained collection of package manifests hosted
                on GitHub. Each manifest is a YAML file that describes an
                application: its publisher, version history, installer URLs,
                SHA256 hashes, silent install switches, and supported
                architectures. As of early 2026, the repository contains over
                13,000 unique application packages spanning productivity tools,
                developer utilities, security software, and enterprise
                applications.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>Every submission to the Winget repository goes through automated
                validation that checks installer integrity, manifest schema
                compliance, and hash verification. This validation layer is
                critical for IT administrators because it means the installer
                metadata in the repository has been verified before it reaches
                your deployment pipeline.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>How Winget works on endpoints</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>On a local Windows device, Winget operates as a CLI tool that
                queries the repository index, resolves package metadata, downloads
                the appropriate installer, and executes it with the correct silent
                switches. A typical installation looks like this:</T>
              </p>
              <div className="bg-bg-surface rounded-xl border border-overlay/10 p-4 my-4 overflow-x-auto">
                <pre className="text-sm text-text-secondary font-mono">
                  <code>{`# Search for an application
winget search "Visual Studio Code"

# Install a specific version silently
winget install Microsoft.VisualStudioCode --version 1.96.0 --silent

# Upgrade all installed applications
winget upgrade --all --silent`}</code>
                </pre>
              </div>
              <p className="text-text-secondary leading-relaxed">
                <T>Winget handles the complexity of determining installer type (MSI,
                EXE, MSIX, or Burn bundle), selecting the correct architecture
                (x64, x86, ARM64), and applying the appropriate silent install
                flags. This metadata is exactly what Intune needs to deploy
                applications -- the challenge is bridging the two systems
                effectively.</T>
              </p>

              {/* How Winget and Intune Connect */}
              <h2
                id="how-winget-intune-connect"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>How Winget and Intune Connect</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>The Intune Winget integration is not a single feature -- it is a
                collection of connection points between the Winget ecosystem and
                the Intune management platform. Understanding these connection
                points helps you choose the right approach for your environment.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>The Microsoft Graph API layer</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>All Intune operations, including app management, flow through the
                Microsoft Graph API. When you create a Win32 app in the Intune
                portal, the portal is making Graph API calls to endpoints under{" "}
                <code>deviceAppManagement/mobileApps</code>. These same API
                endpoints are available programmatically, which is how tools like
                IntuneGet automate the deployment process. The key Graph API
                permissions for app management are:</T>
              </p>
              <ul className="space-y-3 text-text-secondary">
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">DeviceManagementApps.ReadWrite.All:</strong>{" "}
                    Required to create, update, and delete application packages in
                    Intune. This is the primary permission needed for any automated
                    deployment workflow.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">DeviceManagementApps.Read.All:</strong>{" "}
                    Read-only access to view existing app deployments and their
                    status. Useful for monitoring and reporting.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">DeviceManagementConfiguration.ReadWrite.All:</strong>{" "}
                    Needed if you want to assign apps to configuration profiles or
                    use app protection policies alongside your deployments.</T>
                  </span>
                </li>
              </ul>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Two integration paths</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>There are fundamentally two ways to bring Winget applications into
                Intune. The first is Microsoft&apos;s native Winget app type, where
                Intune sends a Winget command to the endpoint and the local Winget
                client handles installation. The second is the Win32 app approach,
                where the application installer is sourced from Winget but
                packaged as an <code>.intunewin</code> file and managed entirely
                through the Intune management extension on the device.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>Each path has distinct implications for detection rules, update
                management, offline installation support, and endpoint
                prerequisites. The native Winget path is simpler to set up but
                gives you less control. The Win32 path requires more packaging
                effort upfront but provides the full Intune management feature
                set. IntuneGet automates the Win32 path, giving you the control
                benefits without the manual packaging overhead.</T>
              </p>

              {/* Native Intune Winget Support */}
              <h2
                id="native-intune-winget"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Native Intune Winget Support</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>Microsoft introduced the &quot;Windows package manager app&quot; type in the
                Intune admin center as a way to directly leverage Winget for app
                deployment. This native integration allows administrators to
                browse a curated catalog of Winget packages and add them to Intune
                without any manual packaging steps.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Adding apps from the built-in catalog</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>To add a Winget app natively in Intune, navigate to Apps &gt; All
                apps &gt; Add in the{" "}
                <a
                  href="https://intune.microsoft.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:underline"
                >
                  Intune admin center
                </a>
                . Select &quot;Windows package manager app (Winget)&quot; as the app type.
                You can then search the integrated catalog by application name.
                Once you select an app, Intune pre-fills the app information
                including name, publisher, and description from the Winget
                manifest.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>The deployment workflow assigns the app to user or device groups
                just like any other Intune app. When the policy reaches the
                endpoint, the Intune management extension invokes the local Winget
                client to install the application. Detection is handled
                automatically based on the Winget package metadata.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Limitations of the native approach</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>While the native Winget app type simplifies the initial setup, it
                introduces several constraints that IT administrators need to
                account for:</T>
              </p>
              <ul className="space-y-3 text-text-secondary">
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Partial catalog coverage:</strong>{" "}
                    The built-in catalog exposes only a curated subset of the full
                    Winget repository. Many enterprise-relevant applications are
                    not available through this interface, forcing you to use Win32
                    packaging for those apps anyway.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Endpoint dependency on Winget client:</strong>{" "}
                    Target devices must have the Winget client (App Installer)
                    installed and up to date. If the App Installer package is
                    outdated or missing, the deployment will fail. This creates an
                    additional prerequisite in your device readiness chain.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Limited detection rule customization:</strong>{" "}
                    You cannot define custom detection rules for Winget app types.
                    The detection logic is managed by Winget itself, which can be
                    problematic for applications that install to non-standard
                    directories or use atypical registry patterns.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">No offline installation:</strong>{" "}
                    Because the Winget client downloads the installer at
                    deployment time, endpoints need internet access to the Winget
                    source URLs. This can be an issue for devices on restricted
                    networks or during the initial provisioning phase.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Coarser update control:</strong>{" "}
                    Update management for native Winget apps is tied to the
                    Winget client&apos;s behavior rather than Intune&apos;s supersedence and
                    versioning features that Win32 apps support.</T>
                  </span>
                </li>
              </ul>

              {/* Using IntuneGet for Full Winget Integration */}
              <h2
                id="using-intuneget"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Using IntuneGet for Full Winget Integration</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T><Link href="/" className="text-accent-cyan hover:underline">
                  IntuneGet
                </Link>{" "}
                takes a different approach to the Intune Winget integration. Rather
                than relying on the native Winget app type with its endpoint
                dependencies and limited catalog, IntuneGet uses the Winget
                repository as the application source and packages everything as
                Win32 apps for Intune. This gives you access to the entire 13,000+
                Winget catalog while retaining all of Intune&apos;s Win32 management
                features.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Complete Winget repository access</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>IntuneGet indexes the full Winget repository, not just the curated
                subset available in the Intune portal. Search any application by
                name, publisher, or Winget package ID. For applications that are
                difficult to locate by name, IntuneGet includes AI-powered app
                discovery that matches natural language queries to the correct
                package -- type &quot;remote desktop tool&quot; and it will surface the
                relevant Winget packages.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Automated IntuneWin packaging</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>When you select an application for deployment, IntuneGet
                automatically downloads the installer from the Winget source,
                wraps it in the <code>.intunewin</code> format using the
                Microsoft Win32 Content Prep Tool, and configures the install and
                uninstall commands with the correct silent switches from the
                Winget manifest. There is no need to run the Content Prep Tool
                locally or write PowerShell scripts.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Intelligent detection rules</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>One of the most error-prone parts of manual Intune app deployment
                is configuring detection rules. IntuneGet generates detection
                rules automatically based on the installer type. MSI packages get
                product code detection, EXE installers get file existence checks
                based on known install paths, and registry-based detection is used
                when the Winget manifest provides registry key information. This
                eliminates the guesswork that leads to false &quot;installation failed&quot;
                reports in Intune.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Automated update management</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>IntuneGet monitors the Winget repository for new application
                versions and gives you configurable update policies for each
                deployed app:</T>
              </p>
              <ul className="space-y-3 text-text-secondary">
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Auto-update:</strong>{" "}
                    Automatically re-package and update the Intune deployment when
                    a new version appears in Winget.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Notify only:</strong>{" "}
                    Receive a notification when a new version is available so you
                    can review and approve the update manually.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Pin version:</strong>{" "}
                    Lock the deployment to a specific version, ignoring new
                    releases. Useful for applications that require compatibility
                    testing before updates.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Ignore:</strong>{" "}
                    Stop tracking updates for a particular application entirely.</T>
                  </span>
                </li>
              </ul>
              <p className="text-text-secondary leading-relaxed mt-4">
                <T>To get started with IntuneGet, see the{" "}
                <Link
                  href="/docs/getting-started"
                  className="text-accent-cyan hover:underline"
                >
                  Getting Started guide
                </Link>{" "}
                or{" "}
                <Link
                  href="/auth/signin"
                  className="text-accent-cyan hover:underline"
                >
                  sign in with your Microsoft Entra ID
                </Link>{" "}
                to start deploying immediately. IntuneGet is free, open source
                under the MIT license, and has no seat limits or premium tiers.</T>
              </p>

              {/* Best Practices */}
              <h2
                id="best-practices"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Best Practices for Winget to Intune Deployment</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>Regardless of which integration method you choose, following
                these best practices will reduce deployment failures and improve
                the reliability of your Intune Winget workflow.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Test in pilot groups before broad rollout</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Never deploy a new application or application update directly to
                your entire device fleet. Create a pilot group containing a
                representative sample of hardware configurations and user
                profiles. Assign the app to this group first and monitor the
                installation status in the Intune portal for at least 24-48 hours
                before expanding the assignment. This catches issues with silent
                install failures, detection rule problems, and architecture
                mismatches before they affect production users.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Pin versions for critical applications</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>For applications that are business-critical or that have known
                compatibility requirements with other software in your
                environment, pin the deployment to a specific version rather than
                allowing automatic updates. This is especially important for
                applications like browsers, VPN clients, and collaboration tools
                where a broken update can disrupt user productivity. Test new
                versions in your pilot group before updating the production
                deployment.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Establish an update review cadence</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Set a regular schedule -- weekly or biweekly -- to review pending
                application updates from the Winget repository. IntuneGet&apos;s
                notify-only update policy is ideal for this workflow: you receive
                alerts when new versions are available and can batch-approve
                updates during your review window. This balances the need for
                current software with the operational stability your users depend
                on.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Monitor deployment status actively</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Intune provides detailed installation status reporting for each
                app deployment. Check for patterns in failure reports -- if a
                specific hardware model or Windows build consistently fails, it
                often points to an architecture mismatch or a missing
                prerequisite. For Win32 apps deployed through IntuneGet, the
                Intune management extension logs on the endpoint
                (located in <code>C:\ProgramData\Microsoft\IntuneManagementExtension\Logs</code>)
                contain detailed installation output that helps diagnose failures.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Document your app catalog</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Maintain a record of which Winget packages map to which Intune
                deployments, including the version deployed, the update policy in
                effect, and any custom configuration applied. This documentation
                is invaluable during incident response, audits, and when
                onboarding new team members. IntuneGet tracks this mapping
                automatically in its dashboard, but maintaining an external record
                as a backup is a sound operational practice.</T>
              </p>

              {/* Limitations */}
              <h2
                id="limitations"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Winget Intune Integration Limitations to Know</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>While the Intune Winget integration covers a large portion of
                enterprise application needs, there are scenarios where it does
                not apply. Understanding these boundaries helps you plan a
                complete app management strategy.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Applications not in the Winget repository</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Winget contains over 13,000 packages, but it does not cover every
                application. Proprietary enterprise software, niche vertical
                applications, and internally developed tools will not be found in
                the Winget catalog. For these applications, you will still need to
                use the traditional Win32 app packaging workflow in Intune --
                download the installer from the vendor, package it with the
                Content Prep Tool, and configure detection rules manually.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Custom line-of-business applications</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>LOB applications developed in-house are outside the scope of any
                Winget integration. These apps typically use MSI or MSIX formats
                and are uploaded directly to Intune as LOB app types or packaged
                as Win32 apps. If your organization develops internal tools, plan
                for a separate packaging and deployment pipeline alongside your
                Winget-based workflow.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Network and firewall considerations</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Both the native Winget app type and IntuneGet-based Win32
                deployments require network access to download installers. For the
                native approach, endpoints need access to the Winget source URLs
                (primarily GitHub and CDN endpoints) at installation time. For the
                Win32 approach, the installer download happens server-side during
                packaging, but the <code>.intunewin</code> file is then
                distributed through Intune&apos;s content delivery network.
                Organizations with strict egress filtering should ensure the
                relevant URLs are allowed. The Intune CDN endpoints are documented
                in Microsoft&apos;s{" "}
                <a
                  href="https://learn.microsoft.com/en-us/mem/intune/fundamentals/intune-endpoints"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:underline"
                >
                  network requirements documentation
                </a>
                .</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Winget manifest quality varies</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Because the Winget repository is community-maintained, manifest
                quality is not uniform across all packages. Some manifests have
                incomplete silent install switches, outdated installer URLs, or
                missing architecture specifications. When deploying lesser-known
                applications, verify the Winget manifest data and test the
                deployment in a pilot group before rolling out broadly. IntuneGet
                mitigates this by validating manifest data during the packaging
                process and alerting you to potential issues.</T>
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
                    <T>Does Intune natively support Winget?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>Yes, Microsoft has added native Winget support to Intune
                    through the &quot;Windows package manager app&quot; type. However, the
                    built-in catalog only exposes a subset of the full Winget
                    repository and offers limited control over packaging, detection
                    rules, and update policies compared to the Win32 app approach
                    used by tools like IntuneGet.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>What is the difference between Winget apps and Win32 apps in Intune?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>Winget apps in Intune are deployed using the Windows Package
                    Manager client on the endpoint device. Win32 apps use the
                    .intunewin format and are managed entirely through the Intune
                    management extension. Win32 apps give you more control over
                    detection rules, requirement rules, and dependencies. IntuneGet
                    bridges both approaches by sourcing apps from Winget and
                    packaging them as Win32 apps for full Intune management
                    capabilities.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>Can I use Winget to update apps already deployed through Intune?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>If the apps were deployed as Winget app types, Intune can
                    leverage Winget for updates. For Win32 apps, you need to create
                    a new app version in Intune with the updated installer.
                    IntuneGet automates this process by monitoring the Winget
                    repository for version changes and offering configurable update
                    policies including auto-update, notify-only, and version
                    pinning.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>Do endpoints need Winget installed for Intune Winget integration?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>It depends on the deployment method. If you use Intune&apos;s
                    native Winget app type, endpoints must have the Winget client
                    (App Installer) present. If you use IntuneGet to package Winget
                    apps as Win32 <code>.intunewin</code> files, endpoints do not
                    need Winget installed because the installer is bundled in the
                    package.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>How many apps are available in the Intune Winget catalog vs the full Winget repository?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>The full Winget repository contains over 13,000 application
                    packages. Intune&apos;s built-in Winget catalog exposes a curated
                    subset of these packages. The exact number in the built-in
                    catalog varies as Microsoft continues to expand it, but it
                    remains significantly smaller than the full repository.
                    IntuneGet provides access to the entire Winget repository,
                    allowing IT admins to deploy any available package to Intune as
                    a fully managed Win32 application.</T>
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
                <T>The Intune Winget integration gives IT administrators a
                fundamentally better way to manage application deployments
                compared to the manual download-package-upload cycle of the past.
                Microsoft&apos;s native Winget app type in the Intune portal is a
                solid starting point for organizations that need a quick, low-effort
                way to deploy common applications. However, the limited catalog,
                endpoint dependencies, and restricted customization options mean
                it cannot serve as a complete app management strategy on its own.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>For IT teams that need access to the full Winget repository with
                the reliability and control of Win32 app packaging, IntuneGet
                provides the automation layer that connects these two worlds.
                Automatic IntuneWin packaging, intelligent detection rule
                generation, and configurable update policies eliminate the manual
                effort while preserving the management features that enterprise
                Intune deployments require.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>The key is choosing the right approach -- or combination of
                approaches -- for your environment. Use the native Winget app type
                for simple, widely available applications where minimal
                customization is needed. Use IntuneGet for the broader catalog,
                for applications requiring custom detection rules, and for any
                deployment where automated update management is a priority. For a
                hands-on walkthrough of deploying your first app, see our{" "}
                <Link href="/blog/deploy-winget-apps-to-intune" className="text-accent-cyan hover:underline">
                  complete Winget to Intune deployment guide
                </Link>
                . To understand the time savings of automation over manual
                processes, read{" "}
                <Link href="/blog/winget-vs-manual-intune-deployment" className="text-accent-cyan hover:underline">
                  Winget vs manual Intune deployment
                </Link>
                .</T>
              </p>

              {/* CTA */}
              <div className="mt-10 p-6 rounded-2xl bg-accent-cyan/5 border border-accent-cyan/20">
                <h3 className="text-xl font-bold text-text-primary mb-3">
                  <T>Get the full Intune Winget integration with IntuneGet</T>
                </h3>
                <p className="text-text-secondary mb-4">
                  <T>Access the complete Winget repository, automate IntuneWin
                  packaging, and deploy applications to Intune in minutes. Free,
                  open source, and no seat limits.</T>
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/auth/signin"
                    className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-accent-cyan rounded-xl hover:bg-accent-cyan-dim transition-colors"
                  >
                    <T>Start Free Deployment</T>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                  <Link
                    href="/docs/getting-started"
                    className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-text-secondary bg-bg-elevated border border-overlay/10 rounded-xl hover:bg-overlay/[0.04] transition-colors"
                  >
                    <T>Read the Getting Started Guide</T>
                  </Link>
                </div>
              </div>
            </div>

            <BlogAuthorCard />

            <RelatedPosts
              posts={blogPosts.filter(
                (p) => p.slug !== "intune-winget-integration-guide"
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
