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

const post = getBlogPost("deploy-winget-apps-to-intune")!;

export const metadata: Metadata = {
  title: post.title,
  description: post.description,
  alternates: {
    canonical: "https://intuneget.com/blog/deploy-winget-apps-to-intune",
  },
  openGraph: {
    title: post.title,
    description: post.description,
    url: "https://intuneget.com/blog/deploy-winget-apps-to-intune",
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
      item: "https://intuneget.com/blog/deploy-winget-apps-to-intune",
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
    "https://intuneget.com/blog/deploy-winget-apps-to-intune",
  keywords: [
    "Intune Winget",
    "deploy Winget apps to Intune",
    "Winget Intune integration",
    "IntuneGet",
    "Intune app deployment",
    "Winget to Intune",
  ],
  proficiencyLevel: "Beginner",
  dependencies: "Microsoft Intune license, Azure AD tenant",
};

const howToJsonLd = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How to Deploy Winget Apps to Microsoft Intune",
  description:
    "Step-by-step guide to deploying applications from the Winget package manager to Microsoft Intune using IntuneGet.",
  totalTime: "PT5M",
  estimatedCost: {
    "@type": "MonetaryAmount",
    currency: "USD",
    value: "0",
  },
  step: [
    {
      "@type": "HowToStep",
      position: 1,
      name: "Sign in to IntuneGet",
      text: "Navigate to intuneget.com and sign in with your Microsoft Entra ID account that has Intune admin permissions.",
    },
    {
      "@type": "HowToStep",
      position: 2,
      name: "Search and select Winget apps",
      text: "Use the search bar to find applications from the Winget repository. Select the apps you want to deploy to Intune.",
    },
    {
      "@type": "HowToStep",
      position: 3,
      name: "Deploy to Intune",
      text: "Click deploy and IntuneGet will automatically package the app as an IntuneWin file, generate detection rules, and upload it to your Intune tenant.",
    },
  ],
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is Winget to Intune deployment?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Winget to Intune deployment is the process of taking applications from the Windows Package Manager (Winget) repository and packaging them for distribution through Microsoft Intune. This involves converting application installers into the .intunewin format, configuring detection rules, and uploading them to your Intune tenant for assignment to devices.",
      },
    },
    {
      "@type": "Question",
      name: "Is IntuneGet free to use for Winget app deployment?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. IntuneGet is completely free and open source under the MIT license. There are no seat limits, no hidden fees, and no premium tiers. You can deploy as many Winget apps to Intune as you need at zero cost.",
      },
    },
    {
      "@type": "Question",
      name: "How long does it take to deploy a Winget app to Intune?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Using IntuneGet, a typical Winget app can be deployed to Intune in about 5 minutes. This includes searching for the app, automatic packaging into .intunewin format, detection rule generation, and upload to your Intune tenant. Manual deployment of the same app typically takes 1-2 hours.",
      },
    },
    {
      "@type": "Question",
      name: "Does IntuneGet support automatic updates for Winget apps?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. IntuneGet includes an automated update management system that monitors Winget for new app versions and can automatically update your Intune deployments. You can configure update policies including auto-update, notify-only, ignore, or pin to a specific version.",
      },
    },
    {
      "@type": "Question",
      name: "What is the difference between IntuneGet and Intune's built-in Winget catalog?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Intune's built-in Winget catalog provides a subset of Winget apps through the Intune portal. IntuneGet offers access to the full 13,000+ Winget repository, provides automatic IntuneWin packaging, generates detection rules, supports automated updates, and includes AI-powered app discovery. IntuneGet gives IT admins more control over the packaging and deployment process.",
      },
    },
    {
      "@type": "Question",
      name: "Can I self-host IntuneGet for Winget app deployment?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. IntuneGet can be self-hosted using Docker, giving you complete control over your deployment environment. Your data stays in your infrastructure and you can customize the setup to meet your organization's security and compliance requirements.",
      },
    },
    {
      "@type": "Question",
      name: "What permissions are needed to deploy Winget apps via IntuneGet?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "IntuneGet requires Microsoft Graph API permissions for Intune device management. Specifically, you need DeviceManagementApps.ReadWrite.All to create and manage app deployments. IntuneGet includes a pre-upload permission checker that verifies all required API access before starting any deployment.",
      },
    },
  ],
};

const tocItems = [
  { id: "what-is-winget-to-intune-deployment", title: "What Is Winget to Intune Deployment?", level: 2 },
  { id: "why-winget-matters", title: "Why Winget Matters for Intune Admins", level: 2 },
  { id: "method-1-intuneget", title: "Method 1: Using IntuneGet (Recommended)", level: 2 },
  { id: "method-2-manual", title: "Method 2: Manual Winget + IntuneWin Packaging", level: 2 },
  { id: "method-3-built-in-catalog", title: "Method 3: Built-in Winget Catalog", level: 2 },
  { id: "comparison-table", title: "Comparison: IntuneGet vs Manual vs Built-in Catalog", level: 2 },
  { id: "troubleshooting", title: "Troubleshooting Common Issues", level: 2 },
  { id: "faq", title: "Frequently Asked Questions", level: 2 },
  { id: "conclusion", title: "Conclusion", level: 2 },
];

export default function DeployWingetAppsToIntunePage() {
  const jsonLdScripts = [breadcrumbJsonLd, articleJsonLd, howToJsonLd, faqJsonLd];

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
                <T>Deploying applications to Microsoft Intune remains one of the most
                time-consuming tasks for IT administrators. Between downloading
                installers, creating IntuneWin packages, writing detection rules, and
                configuring deployment settings, a single app can take hours to get
                right. The Windows Package Manager (Winget) has changed how Windows
                applications are discovered and installed -- but bridging the gap between
                Winget and Intune has traditionally required significant manual effort.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>This guide covers three methods to deploy Winget apps to Microsoft
                Intune: using{" "}
                <Link href="/" className="text-accent-cyan hover:underline">
                  IntuneGet
                </Link>{" "}
                for fully automated deployment, manual packaging with the IntuneWin
                Content Prep Tool, and Microsoft&apos;s built-in Winget catalog in the
                Intune portal. By the end, you will know exactly which approach fits
                your organization and how to get your first app deployed in under 5
                minutes.</T>
              </p>

              {/* What is Winget to Intune Deployment */}
              <h2
                id="what-is-winget-to-intune-deployment"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>What Is Winget to Intune Deployment?</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>Winget to Intune deployment is the process of taking applications from
                the Windows Package Manager (Winget) repository and packaging them for
                distribution through Microsoft Intune. Winget maintains a repository
                of over 13,000 application packages with verified installers, version
                metadata, and hash validation. Intune, as Microsoft&apos;s cloud-based
                endpoint management platform, requires applications in a specific
                format -- the <code>.intunewin</code> package -- with detection rules
                that verify successful installation.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>The challenge lies in the translation layer between these two systems.
                Winget applications use standard installer formats (MSI, EXE, MSIX)
                while Intune needs those installers wrapped in the IntuneWin format
                along with install commands, uninstall commands, detection rules, and
                requirement rules. Automating this translation is where tools like
                IntuneGet deliver the most value.</T>
              </p>

              {/* Why Winget Matters for Intune Admins */}
              <h2
                id="why-winget-matters"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Why Winget Matters for Intune Admins</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>Before Winget, IT admins sourcing applications for Intune had to
                manually visit vendor websites, download installers, verify file
                integrity, and hope the download link would remain stable for future
                updates. Winget solves several critical problems:</T>
              </p>
              <ul className="space-y-3 text-text-secondary">
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Centralized app repository:</strong>{" "}
                    Over 13,000 verified packages in a single searchable catalog, eliminating
                    the need to hunt for installers across vendor websites.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Hash verification:</strong>{" "}
                    Every package includes SHA256 hashes ensuring installer integrity,
                    reducing the risk of deploying tampered binaries through Intune.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Version tracking:</strong>{" "}
                    Winget tracks every published version of an application, making it
                    straightforward to deploy specific versions or update existing
                    Intune deployments when new releases appear.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Standardized metadata:</strong>{" "}
                    Package manifests include publisher information, license details,
                    installer types, and silent install switches -- exactly the data
                    needed for Intune Win32 app configuration.</T>
                  </span>
                </li>
              </ul>
              <p className="text-text-secondary leading-relaxed">
                <T>The combination of Winget&apos;s comprehensive catalog and Intune&apos;s
                device management capabilities creates a powerful deployment pipeline.
                The question is how efficiently you connect them.</T>
              </p>

              {/* Method 1: IntuneGet */}
              <h2
                id="method-1-intuneget"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Method 1: Using IntuneGet (Recommended)</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T><Link href="/" className="text-accent-cyan hover:underline">
                  IntuneGet
                </Link>{" "}
                is a free, open-source tool that fully automates the Winget to Intune
                deployment pipeline. It handles application discovery, IntuneWin
                packaging, detection rule generation, and Intune upload in a single
                workflow. Here is how to deploy your first Winget app to Intune using
                IntuneGet:</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Step 1: Sign in with your Microsoft Entra ID</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Navigate to{" "}
                <Link href="/auth/signin" className="text-accent-cyan hover:underline">
                  intuneget.com
                </Link>{" "}
                and sign in with your Microsoft Entra ID account. IntuneGet uses
                Microsoft authentication directly -- no separate account creation
                needed. Your account needs Intune admin permissions
                (DeviceManagementApps.ReadWrite.All) to create and upload app packages.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>Before any deployment, IntuneGet runs a pre-upload permission check
                that tests your actual API access. This catches permission issues
                before you invest time in packaging, avoiding the frustrating mid-process
                failures common with manual deployment.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Step 2: Search and select applications from the Winget catalog</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Use the search bar to find applications from the full Winget repository
                of 13,000+ packages. IntuneGet supports partial and fuzzy search -- type
                &quot;chr&quot; to find Google Chrome, or &quot;code&quot; to find Visual Studio Code. For
                applications that are difficult to find by name, IntuneGet includes
                AI-powered app discovery that uses OpenAI to match your search query to
                the correct Winget package ID.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>Select one or multiple applications to deploy. You can review the
                package details including version, publisher, installer type, and
                silent install switches before proceeding.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Step 3: Deploy to Microsoft Intune</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Click the deploy button and IntuneGet handles the rest. Behind the
                scenes, it performs the following steps automatically:</T>
              </p>
              <ol className="space-y-2 text-text-secondary list-decimal list-inside">
                <li><T>Downloads the application installer from the Winget source</T></li>
                <li><T>Creates the <code>.intunewin</code> package using the Microsoft Win32 Content Prep Tool</T></li>
                <li><T>Generates detection rules based on the installer type (MSI product code, file path, or registry key)</T></li>
                <li><T>Configures install and uninstall commands with silent switches</T></li>
                <li><T>Uploads the package to your Microsoft Intune tenant via the Graph API</T></li>
                <li><T>Sets up requirement rules (OS architecture, minimum OS version)</T></li>
              </ol>
              <p className="text-text-secondary leading-relaxed mt-4">
                <T>The entire process takes approximately 5 minutes per application. Once
                uploaded, the app appears in your Intune portal ready for assignment
                to device groups or users. For a detailed walkthrough of the initial
                setup, see the{" "}
                <Link href="/docs/getting-started" className="text-accent-cyan hover:underline">
                  Getting Started guide
                </Link>
                .</T>
              </p>

              {/* Method 2: Manual */}
              <h2
                id="method-2-manual"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Method 2: Manual Winget + IntuneWin Packaging</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>The manual approach gives you complete control over every aspect of
                packaging but requires significantly more time and scripting knowledge.
                Here is the typical workflow for manually deploying a Winget app to
                Intune:</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Step 1: Download the installer using Winget</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>First, identify the Winget package ID for your target application and
                download the installer. Open a PowerShell terminal and run:</T>
              </p>
              <div className="bg-bg-surface rounded-xl border border-overlay/10 p-4 my-4 overflow-x-auto">
                <pre className="text-sm text-text-secondary font-mono">
                  <code>{`# Search for the application
winget search "Google Chrome"

# Download the installer (example: Google Chrome)
winget download Google.Chrome --download-directory C:\\IntunePackaging\\Chrome

# Verify the downloaded file
Get-FileHash C:\\IntunePackaging\\Chrome\\*.msi -Algorithm SHA256`}</code>
                </pre>
              </div>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Step 2: Package as IntuneWin</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Download the{" "}
                <a
                  href="https://github.com/Microsoft/Microsoft-Win32-Content-Prep-Tool"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:underline"
                >
                  Microsoft Win32 Content Prep Tool
                </a>{" "}
                and use it to create the <code>.intunewin</code> package:</T>
              </p>
              <div className="bg-bg-surface rounded-xl border border-overlay/10 p-4 my-4 overflow-x-auto">
                <pre className="text-sm text-text-secondary font-mono">
                  <code>{`# Create the IntuneWin package
IntuneWinAppUtil.exe -c C:\\IntunePackaging\\Chrome -s ChromeSetup.msi -o C:\\IntuneOutput -q`}</code>
                </pre>
              </div>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Step 3: Configure detection rules and upload to Intune</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Log in to the{" "}
                <a
                  href="https://intune.microsoft.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:underline"
                >
                  Microsoft Intune admin center
                </a>
                , navigate to Apps &gt; All apps &gt; Add, and select &quot;Windows app
                (Win32)&quot;. Upload your <code>.intunewin</code> file and manually configure:</T>
              </p>
              <ul className="space-y-2 text-text-secondary">
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted mt-2.5 flex-shrink-0" />
                  <span><T>App information (name, description, publisher)</T></span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted mt-2.5 flex-shrink-0" />
                  <span><T>Install command (e.g., <code>msiexec /i ChromeSetup.msi /qn</code>)</T></span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted mt-2.5 flex-shrink-0" />
                  <span><T>Uninstall command</T></span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted mt-2.5 flex-shrink-0" />
                  <span><T>Detection rules (MSI product code, file existence, or registry key)</T></span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted mt-2.5 flex-shrink-0" />
                  <span><T>Requirement rules (architecture, minimum OS version)</T></span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted mt-2.5 flex-shrink-0" />
                  <span><T>Return codes for success and failure conditions</T></span>
                </li>
              </ul>
              <p className="text-text-secondary leading-relaxed mt-4">
                <T>This manual process typically takes 1-2 hours per application,
                including testing. For organizations managing dozens or hundreds of
                applications, the time investment compounds rapidly.</T>
              </p>

              {/* Method 3: Built-in Catalog */}
              <h2
                id="method-3-built-in-catalog"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Method 3: Intune&apos;s Built-in Winget Catalog</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>Microsoft has been gradually integrating the Winget catalog directly
                into the Intune admin portal. This approach requires the least technical
                knowledge but comes with notable limitations.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>In the Intune admin center, navigate to Apps &gt; All apps &gt; Add
                and select &quot;Windows package manager app (Winget)&quot;. You can search the
                integrated catalog and add applications directly. Intune handles the
                packaging and deployment automatically.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>However, the built-in catalog has several constraints that make it
                unsuitable as a sole deployment strategy:</T>
              </p>
              <ul className="space-y-2 text-text-secondary">
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Limited catalog:</strong> Only a
                    subset of the full Winget repository is available. Many common enterprise
                    applications are missing.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">No custom detection rules:</strong>{" "}
                    You cannot customize detection logic, which can cause issues with
                    applications that install to non-standard paths.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Limited update control:</strong>{" "}
                    Update policies are less granular than what you get with IntuneGet&apos;s
                    auto-update, notify, ignore, or pin-version modes.</T>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted mt-2.5 flex-shrink-0" />
                  <span>
                    <T><strong className="text-text-primary">Requires Winget on endpoints:</strong>{" "}
                    Target devices need the Winget client installed, which adds a
                    prerequisite to your deployment chain.</T>
                  </span>
                </li>
              </ul>

              {/* Comparison Table */}
              <h2
                id="comparison-table"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Comparison: IntuneGet vs Manual vs Built-in Catalog</T>
              </h2>
              <p className="text-text-secondary leading-relaxed mb-6">
                <T>The following table compares the three methods for deploying Winget
                apps to Microsoft Intune across key criteria that matter most to IT
                teams:</T>
              </p>

              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-overlay/10">
                      <th className="text-left p-3 font-semibold text-text-primary"><T>Feature</T></th>
                      <th className="text-left p-3 font-semibold text-accent-cyan"><T>IntuneGet</T></th>
                      <th className="text-left p-3 font-semibold text-text-secondary"><T>Manual Process</T></th>
                      <th className="text-left p-3 font-semibold text-text-secondary"><T>Built-in Catalog</T></th>
                    </tr>
                  </thead>
                  <tbody className="text-text-secondary">
                    <tr className="border-b border-overlay/[0.06]">
                      <td className="p-3 font-medium text-text-primary"><T>Cost</T></td>
                      <td className="p-3"><T>Free (MIT license)</T></td>
                      <td className="p-3"><T>Free (your time)</T></td>
                      <td className="p-3"><T>Included with Intune license</T></td>
                    </tr>
                    <tr className="border-b border-overlay/[0.06]">
                      <td className="p-3 font-medium text-text-primary"><T>Available Apps</T></td>
                      <td className="p-3"><T>13,000+ (full Winget repo)</T></td>
                      <td className="p-3"><T>Unlimited</T></td>
                      <td className="p-3"><T>Subset of Winget</T></td>
                    </tr>
                    <tr className="border-b border-overlay/[0.06]">
                      <td className="p-3 font-medium text-text-primary"><T>Time per App</T></td>
                      <td className="p-3"><T>~5 minutes</T></td>
                      <td className="p-3"><T>1-2 hours</T></td>
                      <td className="p-3"><T>~10 minutes</T></td>
                    </tr>
                    <tr className="border-b border-overlay/[0.06]">
                      <td className="p-3 font-medium text-text-primary"><T>IntuneWin Packaging</T></td>
                      <td className="p-3"><T>Automatic</T></td>
                      <td className="p-3"><T>Manual</T></td>
                      <td className="p-3"><T>Not required</T></td>
                    </tr>
                    <tr className="border-b border-overlay/[0.06]">
                      <td className="p-3 font-medium text-text-primary"><T>Detection Rules</T></td>
                      <td className="p-3"><T>Auto-generated</T></td>
                      <td className="p-3"><T>Manual configuration</T></td>
                      <td className="p-3"><T>Automatic (limited)</T></td>
                    </tr>
                    <tr className="border-b border-overlay/[0.06]">
                      <td className="p-3 font-medium text-text-primary"><T>Automatic Updates</T></td>
                      <td className="p-3"><T>Yes (configurable policies)</T></td>
                      <td className="p-3"><T>No</T></td>
                      <td className="p-3"><T>Limited</T></td>
                    </tr>
                    <tr className="border-b border-overlay/[0.06]">
                      <td className="p-3 font-medium text-text-primary"><T>Scripting Required</T></td>
                      <td className="p-3"><T>None</T></td>
                      <td className="p-3"><T>PowerShell knowledge needed</T></td>
                      <td className="p-3"><T>None</T></td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium text-text-primary"><T>Self-hosting Option</T></td>
                      <td className="p-3"><T>Yes (Docker)</T></td>
                      <td className="p-3"><T>N/A</T></td>
                      <td className="p-3"><T>No</T></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Troubleshooting */}
              <h2
                id="troubleshooting"
                className="text-2xl md:text-3xl font-bold text-text-primary mt-12 mb-4"
              >
                <T>Troubleshooting Common Issues</T>
              </h2>
              <p className="text-text-secondary leading-relaxed">
                <T>Whether you use IntuneGet or the manual approach, certain issues can
                arise when deploying Winget apps to Intune. Here are the most common
                problems and their solutions:</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Detection rule failures</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>The most common deployment issue is incorrect detection rules. If
                Intune cannot verify that an application installed successfully, it
                will report the deployment as failed even though the app is present on
                the device. For MSI-based installers, use the MSI product code for
                detection. For EXE installers, use file existence checks (verify the
                main executable path) or registry key detection. IntuneGet automatically
                selects the most reliable detection method based on the installer type.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>System context vs user context installation</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Intune Win32 apps install in system context by default. Some
                applications, particularly those designed for per-user installation,
                may fail or install to unexpected locations when run as SYSTEM. If you
                encounter installation failures, check whether the application supports
                machine-wide installation and adjust the install behavior in Intune
                accordingly.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Installer type mismatches</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>Winget packages can contain different installer types (MSI, EXE, MSIX,
                Burn bundles). Each type requires different silent install switches and
                detection strategies. A common mistake in manual deployment is using
                MSI switches (<code>/qn</code>) for EXE-based installers that use
                different silent flags (<code>/S</code>, <code>/silent</code>,{" "}
                <code>--silent</code>). IntuneGet reads the Winget manifest to
                determine the correct installer type and applies the appropriate
                command-line switches automatically.</T>
              </p>

              <h3 className="text-xl font-semibold text-text-primary mt-8 mb-3">
                <T>Graph API permission errors</T>
              </h3>
              <p className="text-text-secondary leading-relaxed">
                <T>If you encounter 403 Forbidden errors during upload, verify your
                Azure AD app registration has the{" "}
                <code>DeviceManagementApps.ReadWrite.All</code> permission with admin
                consent granted. IntuneGet&apos;s{" "}
                <Link href="/docs/azure-setup" className="text-accent-cyan hover:underline">
                  Azure Setup guide
                </Link>{" "}
                walks through the exact configuration required. The built-in
                permission checker will identify missing permissions before you start
                any deployment.</T>
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
                    <T>What is Winget to Intune deployment?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>Winget to Intune deployment is the process of taking applications
                    from the Windows Package Manager (Winget) repository and packaging
                    them for distribution through Microsoft Intune. This involves
                    converting application installers into the .intunewin format,
                    configuring detection rules, and uploading them to your Intune
                    tenant for assignment to devices.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>Is IntuneGet free to use for Winget app deployment?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>Yes. IntuneGet is completely free and open source under the MIT
                    license. There are no seat limits, no hidden fees, and no premium
                    tiers. You can deploy as many Winget apps to Intune as you need at
                    zero cost.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>How long does it take to deploy a Winget app to Intune?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>Using IntuneGet, a typical Winget app can be deployed to Intune in
                    about 5 minutes. This includes searching for the app, automatic
                    packaging into .intunewin format, detection rule generation, and
                    upload to your Intune tenant. Manual deployment of the same app
                    typically takes 1-2 hours.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>Does IntuneGet support automatic updates for Winget apps?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>Yes. IntuneGet includes an automated update management system that
                    monitors Winget for new app versions and can automatically update
                    your Intune deployments. You can configure update policies including
                    auto-update, notify-only, ignore, or pin to a specific version.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>What is the difference between IntuneGet and Intune&apos;s built-in Winget catalog?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>Intune&apos;s built-in Winget catalog provides a subset of Winget apps
                    through the Intune portal. IntuneGet offers access to the full
                    13,000+ Winget repository, provides automatic IntuneWin packaging,
                    generates detection rules, supports automated updates, and includes
                    AI-powered app discovery. IntuneGet gives IT admins more control
                    over the packaging and deployment process.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>Can I self-host IntuneGet for Winget app deployment?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>Yes. IntuneGet can be self-hosted using Docker, giving you complete
                    control over your deployment environment. Your data stays in your
                    infrastructure and you can customize the setup to meet your
                    organization&apos;s security and compliance requirements. See the{" "}
                    <Link href="/docs/docker" className="text-accent-cyan hover:underline">
                      Docker deployment guide
                    </Link>{" "}
                    for setup instructions.</T>
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    <T>What permissions are needed to deploy Winget apps via IntuneGet?</T>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    <T>IntuneGet requires Microsoft Graph API permissions for Intune
                    device management. Specifically, you need
                    DeviceManagementApps.ReadWrite.All to create and manage app
                    deployments. IntuneGet includes a pre-upload permission checker
                    that verifies all required API access before starting any
                    deployment. See the{" "}
                    <Link href="/docs/azure-setup" className="text-accent-cyan hover:underline">
                      Azure Setup guide
                    </Link>{" "}
                    for detailed configuration steps.</T>
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
                <T>Deploying Winget apps to Microsoft Intune does not have to be a
                time-consuming, error-prone process. While the manual approach gives
                you full control and the built-in catalog offers convenience for basic
                needs, IntuneGet provides the best balance of automation, app coverage,
                and flexibility for IT teams that manage application deployments at
                scale.</T>
              </p>
              <p className="text-text-secondary leading-relaxed">
                <T>With automatic IntuneWin packaging, intelligent detection rule
                generation, and configurable update policies, IntuneGet turns what was
                traditionally an hours-long process into a 5-minute workflow. And
                because it is free and open source, there is no financial barrier to
                getting started. For a deeper look at how Winget connects to Intune
                at the architecture level, read our{" "}
                <Link href="/blog/intune-winget-integration-guide" className="text-accent-cyan hover:underline">
                  Intune Winget integration guide
                </Link>
                . If you want to see the time savings quantified, our{" "}
                <Link href="/blog/winget-vs-manual-intune-deployment" className="text-accent-cyan hover:underline">
                  Winget vs manual deployment comparison
                </Link>{" "}
                breaks down the numbers. And if you are migrating from SCCM, see our{" "}
                <Link href="/blog/sccm-to-intune-migration-winget" className="text-accent-cyan hover:underline">
                  SCCM to Intune migration guide
                </Link>
                .</T>
              </p>

              {/* CTA */}
              <div className="mt-10 p-6 rounded-2xl bg-accent-cyan/5 border border-accent-cyan/20">
                <h3 className="text-xl font-bold text-text-primary mb-3">
                  <T>Start deploying Winget apps to Intune today</T>
                </h3>
                <p className="text-text-secondary mb-4">
                  <T>Set up IntuneGet in under 5 minutes and deploy your first application
                  for free. No credit card, no seat limits, no hidden fees.</T>
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
                (p) => p.slug !== "deploy-winget-apps-to-intune"
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
