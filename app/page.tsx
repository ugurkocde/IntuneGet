import {
  Header,
  HeroSection,
  FeaturesSection,
  HowItWorksSection,
  FAQSectionAnimated,
  CTASection,
  Footer,
} from "@/components/landing";

export default function LandingPage() {
  // Open source release - deployed from github.com/ugurkocde/IntuneGet
  return (
    <div className="flex flex-col min-h-screen bg-bg-deepest">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <HowItWorksSection />
        <FAQSectionAnimated />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
