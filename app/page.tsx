import {
  Header,
  HeroSection,
  ProblemOutcomeSection,
  TrustSection,
  FeaturesSection,
  ComparisonSection,
  AdvancedCapabilitiesSection,
  MissionSection,
  HowItWorksSection,
  FAQSectionAnimated,
  CTASection,
  Footer,
  QuickFactsSection,
} from "@/components/landing";
import { faqData } from "@/lib/data/faq-data";
import { SectionDivider } from "@/components/landing/ui/SectionDivider";

// SoftwareApplication JSON-LD structured data
const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "IntuneGet",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: "https://intuneget.com",
  downloadUrl: "https://github.com/ugurkocde/IntuneGet",
  softwareVersion: "0.5.0",
  datePublished: "2024-01-01",
  description:
    "IntuneGet is the leading free, open-source tool for deploying 10,000+ Winget applications to Microsoft Intune. No scripting required, 5-minute setup, and trusted by IT teams worldwide.",
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
    "10,000+ Supported Applications",
    "No Scripting Required",
    "Self-Hosting Support via Docker",
    "Microsoft Entra ID Authentication",
    "AI-Powered App Discovery",
    "PSADT v4 Support",
  ],
  screenshot: "https://intuneget.com/og-image.png",
};

// HowTo JSON-LD for rich results
const howToJsonLd = {
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
      text: "Choose the applications you want to deploy from Winget's extensive repository of 10,000+ packages. Use the search interface to find apps by name.",
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

// FAQPage JSON-LD structured data
const faqPageJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqData.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
};

export default function LandingPage() {
  // Open source release - deployed from github.com/ugurkocde/IntuneGet
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
        <main className="flex-1">
          <HeroSection />
          <SectionDivider />
          <ProblemOutcomeSection />
          <HowItWorksSection />
          <FeaturesSection />
          <SectionDivider />
          <ComparisonSection />
          <TrustSection />
          <QuickFactsSection />
          <SectionDivider />
          <AdvancedCapabilitiesSection />
          <MissionSection />
          <FAQSectionAnimated />
          <CTASection />
        </main>
        <Footer />
      </div>
    </>
  );
}
