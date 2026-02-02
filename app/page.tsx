import {
  Header,
  HeroSection,
  CustomerLogosSection,
  ProblemOutcomeSection,
  TrustSection,
  FeaturesSection,
  DemoSection,
  AdvancedCapabilitiesSection,
  HowItWorksSection,
  TestimonialsSection,
  FAQSectionAnimated,
  CTASection,
  Footer,
} from "@/components/landing";

// FAQ data for JSON-LD structured data
const faqData = [
  {
    question: "What is IntuneGet and how does it work?",
    answer:
      "IntuneGet is a powerful tool that bridges the gap between Winget and Microsoft Intune. It automatically packages applications from the Winget repository and uploads them to your Intune environment, streamlining your app deployment process with just a few clicks.",
  },
  {
    question: "Is IntuneGet really 100% free?",
    answer:
      "Yes! IntuneGet is completely free and open source under the MIT license. There are no hidden fees, no premium tiers, and no credit card required. You can use all features without any cost, modify it to fit your needs, and contribute to its development.",
  },
  {
    question: "How long does setup take?",
    answer:
      "Most users are up and running in under 5 minutes. Simply sign in with your Microsoft account, grant the necessary permissions, and you're ready to start deploying apps. Our step-by-step onboarding guides you through the entire process.",
  },
  {
    question: "Where is my data stored?",
    answer:
      "Your credentials and sensitive data never leave your environment. IntuneGet uses secure Microsoft authentication (Entra ID) and only stores minimal metadata needed for the service. All communications are encrypted, and you can self-host for complete control.",
  },
  {
    question: "Which applications are supported?",
    answer:
      "IntuneGet supports over 10,000+ applications available in the Winget repository. This includes popular software like browsers, productivity tools, development environments, and enterprise applications. The list is constantly growing as new apps are added to Winget.",
  },
  {
    question: "Do I need special permissions to use IntuneGet?",
    answer:
      "You'll need appropriate permissions in your Entra ID and Intune environment to upload and manage applications. Typically, this requires Intune Administrator or Application Administrator roles. We provide detailed documentation on the required permissions.",
  },
  {
    question: "What support is available?",
    answer:
      "As an open source project, support is provided through our GitHub community. You can file issues, ask questions in discussions, and get help from other users. We also have comprehensive documentation covering common use cases and troubleshooting.",
  },
  {
    question: "Can I self-host IntuneGet?",
    answer:
      "Yes! IntuneGet is fully open source and can be self-hosted on your own infrastructure. Check out our documentation for detailed setup instructions, or use our hosted service for a hassle-free experience.",
  },
];

// SoftwareApplication JSON-LD structured data
const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "IntuneGet",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: "https://intuneget.com",
  description:
    "Streamline your Microsoft Intune app deployment process with Winget integration. Package and upload applications effortlessly with automated deployment and cloud-native features.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  featureList: [
    "Winget to Intune Integration",
    "Automatic Application Packaging",
    "10,000+ Supported Applications",
    "Self-Hosting Support",
    "Microsoft Entra ID Authentication",
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
      <div className="flex flex-col min-h-screen bg-bg-deepest">
        <Header />
        <main className="flex-1">
          <HeroSection />
          <CustomerLogosSection />
          <ProblemOutcomeSection />
          <TrustSection />
          <FeaturesSection />
          <DemoSection />
          <AdvancedCapabilitiesSection />
          <HowItWorksSection />
          <TestimonialsSection />
          <FAQSectionAnimated />
          <CTASection />
        </main>
        <Footer />
      </div>
    </>
  );
}
