import { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { T, Var } from "gt-next";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { CatalogAppCard } from "@/components/catalog/CatalogAppCard";
import { CatalogCta } from "@/components/catalog/CatalogCta";
import { getCatalogSource } from "@/lib/catalog";
import { mergeCategoryCounts } from "@/lib/catalog/seo";
import { formatAppCountLabel } from "@/lib/stats/public-stats";
import { CatalogSearch } from "./CatalogSearch";

// Refresh the catalog sample at most once an hour
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Browse the App Catalog - IntuneGet",
  description:
    "Browse the Winget catalog IntuneGet deploys to Microsoft Intune - popular apps, publishers, and categories. No sign-in required.",
  alternates: {
    canonical: "https://intuneget.com/apps",
  },
  openGraph: {
    title: "Browse the App Catalog - IntuneGet",
    description:
      "Browse the Winget catalog IntuneGet deploys to Microsoft Intune - popular apps, publishers, and categories. No sign-in required.",
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
      name: "App Catalog",
      item: "https://intuneget.com/apps",
    },
  ],
};

export default async function AppsPage() {
  const source = getCatalogSource();
  const [popular, stats, categories] = await Promise.all([
    source
      .getPopularApps({ limit: 24, offset: 0, sort: "popular" })
      .catch(() => null),
    source.getCatalogStats().catch(() => ({ totalApps: 0 })),
    source.getCategories().catch(() => []),
  ]);

  const apps = popular?.data ?? [];
  const countLabel = formatAppCountLabel(stats.totalApps);
  const mergedCategories = mergeCategoryCounts(categories);

  return (
    <div className="min-h-screen bg-bg-deepest flex flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <main id="main-content" className="flex-1 mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-16 pt-24 lg:pt-28">
        <div className="space-y-10">
          {/* Heading */}
          <div className="space-y-3">
            <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
              <T>Browse the App Catalog</T>
            </h1>
            <p className="text-lg text-text-secondary">
              <T>
                Browse the Winget catalog IntuneGet deploys - no sign-in
                required.
              </T>
            </p>
            {countLabel ? (
              <p className="text-sm text-text-muted">
                <T>
                  <Var>{countLabel}</Var> apps available, packaged and uploaded
                  to Microsoft Intune automatically.
                </T>
              </p>
            ) : (
              <p className="text-sm text-text-muted">
                <T>
                  The full Winget catalog, packaged and uploaded to Microsoft
                  Intune automatically.
                </T>
              </p>
            )}
          </div>

          {/* Search */}
          <CatalogSearch />

          {/* Popular apps grid */}
          <section aria-labelledby="popular-apps-heading" className="space-y-6">
            <h2
              id="popular-apps-heading"
              className="text-xl font-semibold text-text-primary"
            >
              <T>Popular apps</T>
            </h2>
            {apps.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {apps.map((app) => <CatalogAppCard key={app.winget_id} app={app} />)}
              </div>
            ) : (
              <p className="text-text-secondary">
                <T>
                  The catalog sample is unavailable right now. Sign in to
                  search the full catalog and deploy.
                </T>
              </p>
            )}
          </section>

          <section aria-labelledby="browse-category-heading" className="space-y-6">
            <h2 id="browse-category-heading" className="text-xl font-semibold text-text-primary"><T>Browse by category</T></h2>
            {mergedCategories.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {mergedCategories.map(({ slug, name, count }) => (
                  <Link
                    key={slug}
                    href={`/apps/category/${slug}`}
                    className="group inline-flex items-center gap-2.5 rounded-xl border border-overlay/10 bg-bg-elevated px-4 py-2.5 transition-colors hover:border-accent-cyan/40"
                  >
                    <span className="text-sm font-medium text-text-primary group-hover:text-accent-cyan">
                      <Var>{name}</Var>
                    </span>
                    <span className="rounded-full bg-bg-surface px-2 py-0.5 text-xs tabular-nums text-text-muted">
                      <Var>{count.toLocaleString("en-US")}</Var>
                    </span>
                  </Link>
                ))}
              </div>
            ) : <p className="text-text-secondary"><T>Categories are temporarily unavailable. You can still browse the full catalog.</T></p>}
            <Link
              href="/apps/browse"
              className="inline-flex items-center gap-2 rounded-xl border border-accent-cyan/40 px-6 py-3 text-base font-semibold text-accent-cyan transition-colors hover:bg-accent-cyan/10"
            >
              {countLabel ? (
                <T>Browse all <Var>{countLabel}</Var> apps</T>
              ) : (
                <T>Browse all apps</T>
              )}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </section>

          <CatalogCta />
        </div>
      </main>

      <Footer />
    </div>
  );
}
