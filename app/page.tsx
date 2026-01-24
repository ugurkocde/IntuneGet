import {
  Header,
  HeroSection,
  FeaturesSection,
  HowItWorksSection,
  StatsSection,
  FAQSectionAnimated,
  CTASection,
  Footer,
} from "@/components/landing";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-bg-deepest">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <HowItWorksSection />
        <StatsSection />
        <FAQSectionAnimated />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
