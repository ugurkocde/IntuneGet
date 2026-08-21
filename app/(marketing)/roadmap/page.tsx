import { Metadata } from "next";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { T } from "gt-next";
import { roadmapStages } from "@/lib/data/roadmap-data";
import { RoadmapWave } from "./RoadmapWave";
import { RoadmapBoard } from "./RoadmapBoard";

export const metadata: Metadata = {
  title: "Roadmap | IntuneGet - What's Shipped and What's Next",
  description:
    "See where IntuneGet is heading: shipped features, what's being built right now, and what comes next for the free, open-source Intune app deployment tool.",
  alternates: {
    canonical: "https://intuneget.com/roadmap",
  },
  openGraph: {
    title: "IntuneGet Roadmap",
    description:
      "Shipped features, current work, and what comes next for IntuneGet.",
  },
};

const roadmapJsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "IntuneGet Roadmap",
  itemListElement: roadmapStages
    .flatMap((stage) =>
      stage.items.map((item) => ({
        stage: stage.title,
        title: item.title,
        description: item.description,
      }))
    )
    .map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: `${entry.title} (${entry.stage})`,
      description: entry.description,
    })),
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
      name: "Roadmap",
      item: "https://intuneget.com/roadmap",
    },
  ],
};

export default function RoadmapPage() {
  return (
    <div className="min-h-screen bg-bg-deepest flex flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(roadmapJsonLd) }}
      />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-12 pt-24 lg:px-8 lg:py-16 lg:pt-28">
        {/* Hero */}
        <div className="mb-10 text-center">
          <span className="mb-4 inline-block font-mono text-xs uppercase tracking-wider text-accent-cyan">
            <T>Open source · AGPL-3.0</T>
          </span>
          <h1 className="mb-4 text-4xl font-bold text-text-primary md:text-5xl">
            <T>Roadmap</T>
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-text-secondary">
            <T>
              Where IntuneGet is heading: what has shipped, what is being built
              right now, and what comes next. Community priorities shape the
              order.
            </T>
          </p>
          <div className="mt-4 flex items-center justify-center gap-4 text-sm">
            <a
              href="https://github.com/ugurkocde/IntuneGet/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-accent-cyan"
            >
              <T>Request a feature on GitHub</T>
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          </div>
        </div>

        {/* Wave timeline */}
        <div className="mb-14">
          <RoadmapWave />
        </div>

        {/* Filterable stages */}
        <RoadmapBoard />

        <p className="mt-14 border-t border-overlay/10 pt-6 font-mono text-xs text-text-muted">
          <T>
            Timelines are targets, not commitments. Sequencing follows community
            demand.
          </T>
        </p>
      </main>

      <Footer />
    </div>
  );
}
