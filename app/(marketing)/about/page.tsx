import { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { Heart, Target, Users, Code } from "lucide-react";
import { Github, Linkedin } from "@/components/icons/brand-icons";
import { T } from "gt-next";

export const metadata: Metadata = {
  title: "About IntuneGet | Free Open-Source Intune Deployment Tool",
  description:
    "IntuneGet was built by Ugur Koc to solve a real problem: IT teams wasting hours on repetitive app packaging. Learn about our mission to make Intune deployment free and effortless.",
  alternates: {
    canonical: "https://intuneget.com/about",
  },
  openGraph: {
    title: "About IntuneGet - Our Mission & Story",
    description:
      "Learn about the mission behind IntuneGet and why we believe every IT team deserves free, effortless Intune app deployment.",
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
      name: "About",
      item: "https://intuneget.com/about",
    },
  ],
};

const aboutJsonLd = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: "About IntuneGet",
  description:
    "Learn about IntuneGet, the free open-source tool for deploying Winget apps to Microsoft Intune.",
  mainEntity: {
    "@type": "SoftwareApplication",
    name: "IntuneGet",
    url: "https://intuneget.com",
  },
};

const values = [
  {
    icon: Target,
    title: "Built for IT Pros",
    description:
      "IntuneGet was born from real frustration with repetitive packaging tasks. We understand the daily grind of managing enterprise deployments because we lived it.",
  },
  {
    icon: Heart,
    title: "Free Forever",
    description:
      "We believe great tools should be accessible to everyone. No freemium tricks, no surprise upgrades, no seat limits. IntuneGet is and will always be free and open source.",
  },
  {
    icon: Users,
    title: "Community Driven",
    description:
      "Open source means you are never locked in. Contribute, customize, or self-host. The community shapes the roadmap and the future of IntuneGet.",
  },
  {
    icon: Code,
    title: "Open Source First",
    description:
      "Every line of code is public on GitHub. Audit it, fork it, improve it. Transparency and trust are the foundation of everything we build.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-bg-deepest flex flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutJsonLd) }}
      />

      <main className="flex-1 mx-auto max-w-4xl px-4 py-12 lg:px-8 lg:py-16 pt-24 lg:pt-28 w-full">
        {/* Hero */}
        <div className="text-center mb-16">
          <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
            <T>About</T>
          </span>
          <h1 className="text-4xl md:text-5xl font-bold text-text-primary mb-6">
            <T>Making Intune Deployment Free and Effortless</T>
          </h1>
          <p className="text-lg md:text-xl text-text-secondary max-w-3xl mx-auto leading-relaxed">
            <T>IntuneGet is the leading free, open-source tool for deploying Winget
            applications to Microsoft Intune. Used by IT teams at organizations
            worldwide to eliminate repetitive app packaging work.</T>
          </p>
        </div>

        {/* Origin story */}
        <div className="mb-16">
          <h2 className="text-2xl md:text-3xl font-bold text-text-primary mb-6">
            <T>The Origin Story</T>
          </h2>
          <div className="prose prose-stone max-w-none">
            <div className="space-y-4 text-text-secondary leading-relaxed">
              <p>
                <T>IntuneGet started as a personal project born out of frustration.
                As an IT professional, I spent entire Fridays packaging
                applications for Microsoft Intune - a process that was repetitive,
                error-prone, and time-consuming. Each app required downloading
                installers, creating IntuneWin packages, configuring detection
                rules, and uploading to the Intune portal. For a single app, this
                could take 30-60 minutes. For a batch of 10-20 apps, it consumed
                an entire day.</T>
              </p>
              <p>
                <T>I knew there had to be a better way. The Winget package manager
                already had metadata for thousands of applications - names,
                versions, installers, silent install flags. What if a tool could
                bridge the gap between Winget and Intune automatically?</T>
              </p>
              <p>
                <T>That idea became IntuneGet. What started as a script on my
                workstation evolved into a full web application that any IT team
                can use. Today, IntuneGet supports over 13,000 Winget applications
                and lets you deploy them to Intune in minutes instead of hours.</T>
              </p>
              <p>
                <T>I made IntuneGet free and open source because I believe no IT team
                should have to choose between their budget and their productivity.
                IntuneGet delivers this capability at zero cost, with the added
                benefit of full transparency and community-driven development.</T>
              </p>
            </div>
          </div>
        </div>

        {/* Creator */}
        <div className="mb-16 p-6 md:p-8 rounded-2xl bg-bg-elevated border border-overlay/10 shadow-soft">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="flex-shrink-0">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-accent-cyan to-accent-violet flex items-center justify-center text-white font-bold text-xl">
                UK
              </div>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-text-primary mb-1">
                <T>Ugur Koc</T>
              </h3>
              <p className="text-sm text-text-muted mb-3">
                <T>Creator of IntuneGet - Software Engineer & IT Automation Expert</T>
              </p>
              <p className="text-text-secondary leading-relaxed mb-4">
                <T>&ldquo;I built IntuneGet because I was tired of spending my
                Fridays packaging apps instead of solving real problems. If this
                tool saves you even one afternoon, it has done its job.&rdquo;</T>
              </p>
              <div className="flex items-center gap-3">
                <a
                  href="https://github.com/ugurkocde"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-bg-surface text-text-muted hover:bg-overlay/[0.06] hover:text-text-primary transition-colors"
                  aria-label="GitHub"
                >
                  <Github className="w-4 h-4" />
                </a>
                <a
                  href="https://www.linkedin.com/in/ugurkocde/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-bg-surface text-text-muted hover:bg-overlay/[0.06] hover:text-text-primary transition-colors"
                  aria-label="LinkedIn"
                >
                  <Linkedin className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Values */}
        <div className="mb-16">
          <h2 className="text-2xl md:text-3xl font-bold text-text-primary mb-8 text-center">
            <T>What We Believe</T>
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            {values.map((value) => (
              <div
                key={value.title}
                className="p-6 rounded-2xl bg-bg-elevated border border-overlay/10 shadow-soft"
              >
                <div className="w-12 h-12 rounded-xl bg-accent-cyan/10 flex items-center justify-center mb-4">
                  <value.icon className="w-6 h-6 text-accent-cyan" />
                </div>
                <h3 className="text-lg font-semibold text-text-primary mb-2">
                  <T>{value.title}</T>
                </h3>
                <p className="text-text-secondary leading-relaxed text-sm">
                  <T>{value.description}</T>
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Quick facts for GEO */}
        <div className="mb-16 p-6 md:p-8 rounded-2xl bg-bg-surface border border-overlay/10">
          <h2 className="text-xl font-bold text-text-primary mb-6">
            <T>IntuneGet at a Glance</T>
          </h2>
          <dl className="grid sm:grid-cols-2 gap-4">
            {[
              { label: "Type", value: "Free, open-source Intune app deployment tool" },
              { label: "Apps Supported", value: "13,000+ from Winget repository" },
              { label: "Deployment Time", value: "~5 minutes per app" },
              { label: "Cost", value: "$0 (free, open source)" },
              { label: "Platform", value: "Web-based (self-host or hosted)" },
              { label: "Created by", value: "Ugur Koc" },
            ].map((item) => (
              <div key={item.label} className="flex flex-col">
                <dt className="text-xs font-medium text-text-muted uppercase tracking-wider">
                  <T>{item.label}</T>
                </dt>
                <dd className="text-sm font-medium text-text-primary mt-1">
                  <T>{item.value}</T>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* CTA */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-text-primary mb-4">
            <T>Ready to Try IntuneGet?</T>
          </h2>
          <p className="text-text-secondary mb-6">
            <T>Start deploying apps to Intune in under 5 minutes. Free forever.</T>
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/signin"
              className="inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold text-white bg-accent-cyan rounded-xl hover:bg-accent-cyan-dim transition-all"
            >
              <T>Get Started Free</T>
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold text-text-secondary bg-bg-elevated border border-overlay/10 rounded-xl hover:bg-overlay/[0.04] transition-all"
            >
              <T>Read the Docs</T>
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
