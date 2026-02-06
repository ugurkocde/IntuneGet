import { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { Check, X, Minus, ArrowRight, Github } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing | IntuneGet - Free Intune App Deployment Tool",
  description:
    "IntuneGet is completely free. Deploy 10,000+ Winget apps to Microsoft Intune at no cost. See how IntuneGet compares to manual deployment.",
  alternates: {
    canonical: "https://intuneget.com/pricing",
  },
  openGraph: {
    title: "IntuneGet Pricing - Free & Open Source",
    description:
      "IntuneGet is completely free. Deploy 10,000+ Winget apps to Microsoft Intune at no cost. See how it compares to paid alternatives.",
  },
};

const pricingJsonLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "IntuneGet",
  description:
    "Free, open-source Intune app deployment tool. Deploy 10,000+ Winget apps to Microsoft Intune.",
  brand: {
    "@type": "Brand",
    name: "IntuneGet",
  },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    priceValidUntil: "2030-12-31",
  },
};

interface ComparisonRow {
  feature: string;
  intuneGet: string | boolean;
  manual: string | boolean;
}

const comparisonData: ComparisonRow[] = [
  {
    feature: "Annual Cost",
    intuneGet: "$0 (free)",
    manual: "$0 (but high labor cost)",
  },
  {
    feature: "Supported Apps",
    intuneGet: "10,000+ (Winget)",
    manual: "Unlimited (manual work)",
  },
  {
    feature: "Setup Time",
    intuneGet: "5 minutes",
    manual: "N/A",
  },
  {
    feature: "Time per Deployment",
    intuneGet: "~5 minutes",
    manual: "8+ hours",
  },
  {
    feature: "IntuneWin Packaging",
    intuneGet: "Automatic",
    manual: "Manual",
  },
  {
    feature: "Detection Rules",
    intuneGet: "Auto-generated",
    manual: "Manual",
  },
  {
    feature: "PSADT v4 Support",
    intuneGet: true,
    manual: false,
  },
  {
    feature: "Open Source",
    intuneGet: true,
    manual: "N/A",
  },
  {
    feature: "Self-Hosting",
    intuneGet: true,
    manual: "N/A",
  },
  {
    feature: "Seat Limits",
    intuneGet: "Unlimited",
    manual: "N/A",
  },
];

function CellValue({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="w-5 h-5 text-emerald-500 mx-auto" />
    ) : (
      <X className="w-5 h-5 text-red-400 mx-auto" />
    );
  }
  if (value === "N/A") {
    return <Minus className="w-5 h-5 text-stone-300 mx-auto" />;
  }
  return <span className="text-sm text-stone-700">{value}</span>;
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-bg-deepest flex flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingJsonLd) }}
      />

      <main className="flex-1 mx-auto max-w-5xl px-4 py-12 lg:px-8 lg:py-16 pt-24 lg:pt-28 w-full">
        {/* Hero */}
        <div className="text-center mb-16">
          <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
            Pricing
          </span>
          <h1 className="text-4xl md:text-5xl font-bold text-stone-900 mb-4">
            Free. No Catch.
          </h1>
          <p className="text-lg md:text-xl text-stone-600 max-w-2xl mx-auto">
            IntuneGet is 100% free and open source. Deploy 10,000+ Winget apps
            to Microsoft Intune without spending a cent.
          </p>
        </div>

        {/* Pricing card */}
        <div className="max-w-md mx-auto mb-16">
          <div className="bg-white rounded-2xl border-2 border-accent-cyan/30 shadow-soft-xl p-8 text-center">
            <div className="inline-block px-3 py-1 bg-accent-cyan/10 text-accent-cyan text-sm font-semibold rounded-full mb-4">
              Open Source
            </div>
            <div className="mb-2">
              <span className="text-5xl font-bold text-stone-900">$0</span>
              <span className="text-stone-500 ml-2">/always</span>
            </div>
            <p className="text-stone-600 mb-6">
              All features included. No credit card required.
            </p>
            <ul className="text-left space-y-3 mb-8">
              {[
                "10,000+ Winget applications",
                "Unlimited deployments",
                "Unlimited users / seats",
                "Self-hosting with Docker",
                "Microsoft Entra ID authentication",
                "AI-powered app discovery",
                "PSADT v4 support",
                "Community support via GitHub",
                "Fully open source - modify freely",
              ].map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <span className="text-stone-700 text-sm">{feature}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-3">
              <Link
                href="/auth/signin"
                className="inline-flex items-center justify-center gap-2 w-full px-6 py-3 text-base font-semibold text-white bg-accent-cyan rounded-xl hover:bg-accent-cyan-dim transition-all"
              >
                Start Deploying Free
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="https://github.com/ugurkocde/IntuneGet"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 w-full px-6 py-3 text-base font-semibold text-stone-700 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 transition-all"
              >
                <Github className="w-4 h-4" />
                View Source Code
              </a>
            </div>
          </div>
        </div>

        {/* Comparison table */}
        <div className="mb-16">
          <h2 className="text-2xl md:text-3xl font-bold text-stone-900 text-center mb-8">
            How IntuneGet Compares to Manual Deployment
          </h2>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              {/* Table header */}
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="p-3">
                  <span className="sr-only">Feature</span>
                </div>
                <div className="p-3 text-center bg-accent-cyan/10 rounded-t-xl border-2 border-b-0 border-accent-cyan/30">
                  <div className="font-bold text-stone-900">IntuneGet</div>
                  <div className="text-xs text-accent-cyan font-medium">Free & Open Source</div>
                </div>
                <div className="p-3 text-center bg-white rounded-t-xl border border-b-0 border-stone-200">
                  <div className="font-semibold text-stone-700">Manual Process</div>
                  <div className="text-xs text-stone-400">DIY Scripting</div>
                </div>
              </div>

              {/* Table body */}
              <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-soft">
                {comparisonData.map((row, index) => (
                  <div
                    key={row.feature}
                    className={`grid grid-cols-3 gap-3 ${
                      index !== comparisonData.length - 1 ? "border-b border-stone-100" : ""
                    }`}
                  >
                    <div className="p-4 flex items-center">
                      <span className="text-sm font-medium text-stone-900">
                        {row.feature}
                      </span>
                    </div>
                    <div className="p-4 flex items-center justify-center bg-accent-cyan/5 border-x border-accent-cyan/10">
                      <CellValue value={row.intuneGet} />
                    </div>
                    <div className="p-4 flex items-center justify-center">
                      <CellValue value={row.manual} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* FAQ-style content */}
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-stone-900 mb-4">
            Why Is IntuneGet Free?
          </h2>
          <p className="text-stone-600 leading-relaxed mb-6">
            IntuneGet was built by an IT professional who experienced the pain of
            manual app packaging firsthand. The goal is simple: no IT team should
            have to waste hours on repetitive deployment tasks. By keeping IntuneGet
            free and open source, we ensure that every
            organization - from startups to enterprises - can deploy apps to Intune
            efficiently without budget constraints.
          </p>
          <p className="text-sm text-stone-500">
            Have questions?{" "}
            <a
              href="https://github.com/ugurkocde/IntuneGet/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-cyan hover:text-accent-cyan-dim transition-colors"
            >
              Open a GitHub Issue
            </a>
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
