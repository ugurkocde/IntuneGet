import { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { T, Var } from "gt-next";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { AppIcon } from "@/components/AppIcon";
import { getCatalogSource } from "@/lib/catalog";
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
  const [popular, stats] = await Promise.all([
    source
      .getPopularApps({ limit: 24, offset: 0, sort: "popular" })
      .catch(() => null),
    source.getCatalogStats().catch(() => ({ totalApps: 0 })),
  ]);

  const apps = popular?.data ?? [];
  const countLabel = formatAppCountLabel(stats.totalApps);

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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {apps.map((app) => (
                  <div
                    key={app.winget_id}
                    className="flex items-center gap-4 rounded-2xl border border-overlay/10 bg-bg-elevated p-4"
                  >
                    <AppIcon
                      packageId={app.winget_id}
                      packageName={app.name}
                      iconPath={app.icon_path ?? undefined}
                      size="lg"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text-primary">
                        {app.name}
                      </p>
                      <p className="truncate text-sm text-text-muted">
                        {app.publisher}
                      </p>
                    </div>
                  </div>
                ))}
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

          {/* Closing CTA band */}
          <section className="rounded-2xl border border-overlay/10 bg-bg-elevated p-8 text-center space-y-4">
            <h2 className="text-2xl font-bold text-text-primary">
              <T>Ready to deploy these apps to Intune?</T>
            </h2>
            <p className="mx-auto max-w-xl text-text-secondary">
              <T>
                Sign in with your Microsoft work account, pick your apps, and
                deploy your first one in about 5 minutes.
              </T>
            </p>
            <Link
              href="/auth/signin"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-white bg-accent-cyan rounded-xl hover:bg-accent-cyan-dim transition-all duration-300 shadow-glow-cyan hover:shadow-glow-cyan-lg"
            >
              <T>Start Deploying Free</T>
              <ArrowRight className="h-5 w-5" />
            </Link>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
