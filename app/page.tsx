import {
  Header,
  HeroSection,
  TrustSection,
  CapabilitiesSection,
  ComparisonSection,
  HowItWorksSection,
  MSPSection,
  FAQSectionAnimated,
  CTASection,
  Footer,
} from "@/components/landing";
import { faqData } from "@/lib/data/faq-data";
import {
  getPublicLandingStats,
  formatAppCountLabel,
} from "@/lib/stats/public-stats";
import { getGitHubRepoStats } from "@/lib/stats/github-stats";
import packageJson from "../package.json";

// Re-render the page (and refresh the SSR'd counters) at most every 5 minutes
export const revalidate = 300;

// SoftwareApplication JSON-LD structured data, built from the live catalog
// count so structured data never drifts from the on-page claims.
function buildSoftwareApplicationJsonLd(appCountLabel: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "IntuneGet",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: "https://intuneget.com",
    downloadUrl: "https://github.com/ugurkocde/IntuneGet",
    softwareVersion: packageJson.version,
    datePublished: "2024-01-01",
    description:
      "IntuneGet is a free, open-source tool for deploying Winget applications to Microsoft Intune. No scripting required, about 5 minutes per app, self-hostable, AGPL-3.0 licensed.",
    isAccessibleForFree: true,
    license: "https://opensource.org/licenses",
    author: {
      "@type": "Person",
      name: "Ugur Koc",
      url: "https://ugurlabs.com",
    },
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
    featureList: [
      "Winget to Intune Integration",
      "Automatic Application Packaging",
      appCountLabel
        ? `${appCountLabel} Supported Applications`
        : "Thousands of Supported Applications",
      "No Scripting Required",
      "Self-Hosting Support via Docker",
      "Microsoft Entra ID Authentication",
      "AI-Powered App Discovery",
      "PSADT v4 Support",
    ],
    screenshot: "https://intuneget.com/og-image.png",
  };
}

// HowTo JSON-LD for rich results
function buildHowToJsonLd(appCountLabel: string) {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to Deploy Winget Apps to Microsoft Intune with IntuneGet",
    description:
      "Deploy applications from the Winget repository to Microsoft Intune in three simple steps using IntuneGet. No scripting or manual packaging required.",
    totalTime: "PT5M",
    tool: {
      "@type": "HowToTool",
      name: "IntuneGet",
    },
    step: [
      {
        "@type": "HowToStep",
        name: "Select Applications",
        text: appCountLabel
          ? `Choose the applications you want to deploy from the Winget catalog of ${appCountLabel} packages. Use the search interface to find apps by name.`
          : "Choose the applications you want to deploy from the full Winget catalog. Use the search interface to find apps by name.",
        position: 1,
      },
      {
        "@type": "HowToStep",
        name: "Package with Winget",
        text: "IntuneGet automatically packages your selected applications using Winget, handling all the complexity of IntuneWin conversion behind the scenes.",
        position: 2,
      },
      {
        "@type": "HowToStep",
        name: "Upload to Intune",
        text: "Packaged applications are seamlessly uploaded to your Intune environment, ready for deployment to your managed devices.",
        position: 3,
      },
    ],
  };
}

// FAQPage JSON-LD structured data (uses all FAQs including hidden ones)
const faqPageJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqData.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.linkHref
        ? `${faq.answer} Learn more: https://intuneget.com${faq.linkHref}`
        : faq.answer,
    },
  })),
};

export default async function LandingPage() {
  // Open source release - deployed from github.com/ugurkocde/IntuneGet
  const [stats, github] = await Promise.all([
    getPublicLandingStats(),
    getGitHubRepoStats(),
  ]);

  const appCountLabel = formatAppCountLabel(stats.appsSupported);
  const softwareApplicationJsonLd = buildSoftwareApplicationJsonLd(appCountLabel);
  const howToJsonLd = buildHowToJsonLd(appCountLabel);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareApplicationJsonLd),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqPageJsonLd),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(howToJsonLd),
        }}
      />
      <div className="flex flex-col min-h-screen bg-bg-deepest">
        <Header />
        <main id="main-content" className="flex-1">
          <HeroSection initialStats={stats} initialGitHubStars={github.stars} />
          <HowItWorksSection />
          <CapabilitiesSection />
          <ComparisonSection />
          <MSPSection />
          <TrustSection initialStats={stats} />
          <FAQSectionAnimated />
          <CTASection initialGitHubStats={github} />
        </main>
        <Footer />
      </div>
    </>
  );
}
