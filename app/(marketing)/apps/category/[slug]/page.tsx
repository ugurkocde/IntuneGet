import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { T, Var } from 'gt-next';
import { Header } from '@/components/landing/Header';
import { Footer } from '@/components/landing/sections/Footer';
import { CatalogAppCard } from '@/components/catalog/CatalogAppCard';
import { CatalogCta } from '@/components/catalog/CatalogCta';
import { getCatalogSource } from '@/lib/catalog';
import { absoluteAppCatalogUrl, categorySlug } from '@/lib/catalog/seo';

export const revalidate = 86400;

type PageProps = { params: Promise<{ slug: string }> };

const resolveCategory = cache(async (slug: string) => {
  const categories = await getCatalogSource().getCategories().catch(() => []);
  const match = categories.find((item) => categorySlug(item.category) === slug);
  if (!match) notFound();
  return match;
});

export async function generateStaticParams() {
  return getCatalogSource().getCategories()
    .then((categories) => categories.map(({ category }) => ({ slug: categorySlug(category) })))
    .catch(() => []);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { category } = await resolveCategory(slug);
  return {
    title: `Deploy ${category} apps to Microsoft Intune - IntuneGet`,
    description: `Browse ${category} apps that IntuneGet can package and deploy to Microsoft Intune.`,
    alternates: { canonical: `https://intuneget.com/apps/category/${slug}` },
  };
}

export default async function CategoryPage({ params }: PageProps) {
  const { slug } = await params;
  const categoryInfo = await resolveCategory(slug);
  const result = await getCatalogSource()
    .getPopularApps({ limit: 60, offset: 0, category: categoryInfo.category, sort: 'popular' })
    .catch(() => null);
  const apps = result?.data ?? [];

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://intuneget.com' },
      { '@type': 'ListItem', position: 2, name: 'App Catalog', item: 'https://intuneget.com/apps' },
      { '@type': 'ListItem', position: 3, name: categoryInfo.category, item: `https://intuneget.com/apps/category/${slug}` },
    ],
  };
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: apps.length,
    itemListElement: apps.map((app, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: absoluteAppCatalogUrl(app.winget_id),
      name: app.name,
    })),
  };

  return (
    <div className="flex min-h-screen flex-col bg-bg-deepest">
      <Header />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 space-y-10 px-4 pb-16 pt-24 lg:px-8 lg:pt-28">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <Link href="/" className="hover:text-accent-cyan"><T>Home</T></Link><span>/</span>
          <Link href="/apps" className="hover:text-accent-cyan"><T>App Catalog</T></Link><span>/</span>
          <span className="text-text-secondary"><Var>{categoryInfo.category}</Var></span>
        </nav>
        <header className="space-y-4">
          <h1 className="text-3xl font-bold text-text-primary sm:text-4xl"><T>Deploy <Var>{categoryInfo.category}</Var> apps to Microsoft Intune</T></h1>
          <p className="max-w-3xl text-lg text-text-secondary"><T>Explore <Var>{categoryInfo.category}</Var> tools that your organization can package as Win32 apps and upload to Microsoft Intune. IntuneGet keeps the deployment workflow consistent while you choose assignments for each app.</T></p>
          <p className="text-sm text-text-muted"><T><Var>{categoryInfo.count}</Var> apps are available in this category. Showing up to 60 verified apps.</T></p>
        </header>
        <section aria-label="Category apps">
          {apps.length > 0 ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{apps.map((app) => <CatalogAppCard key={app.winget_id} app={app} />)}</div> : <p className="rounded-2xl border border-overlay/10 bg-bg-elevated p-6 text-text-secondary"><T>This category is temporarily unavailable. Return to the app catalog to continue browsing.</T></p>}
        </section>
        <CatalogCta />
      </main>
      <Footer />
    </div>
  );
}

