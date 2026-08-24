import type { Metadata } from 'next';
import Link from 'next/link';
import { T, Var } from 'gt-next';
import { Header } from '@/components/landing/Header';
import { Footer } from '@/components/landing/sections/Footer';
import { CatalogAppCard } from '@/components/catalog/CatalogAppCard';
import { getCatalogSource } from '@/lib/catalog';

const PAGE_SIZE = 60;

type PageProps = { searchParams: Promise<{ page?: string | string[] }> };

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw || '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  const canonical = page === 1 ? 'https://intuneget.com/apps/browse' : `https://intuneget.com/apps/browse?page=${page}`;
  return {
    title: `Browse all apps, page ${page} - IntuneGet`,
    description: 'Browse the complete IntuneGet app catalog for Microsoft Intune deployment.',
    robots: { index: false, follow: true },
    alternates: { canonical },
  };
}

export default async function BrowseAppsPage({ searchParams }: PageProps) {
  const page = parsePage((await searchParams).page);
  const result = await getCatalogSource().getPopularApps({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    sort: 'name',
    verifiedOnly: false,
  }).catch(() => null);
  const apps = result?.data ?? [];
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));
  const hasPrevious = page > 1;
  const hasNext = result !== null && page < totalPages;

  return (
    <div className="flex min-h-screen flex-col bg-bg-deepest">
      <Header />
      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 space-y-10 px-4 pb-16 pt-24 lg:px-8 lg:pt-28">
        <header className="space-y-3">
          <h1 className="text-3xl font-bold text-text-primary sm:text-4xl"><T>Browse all apps</T></h1>
          <p className="text-lg text-text-secondary"><T>Explore the complete catalog available for Microsoft Intune deployment.</T></p>
        </header>
        {apps.length > 0 ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{apps.map((app) => <CatalogAppCard key={app.winget_id} app={app} />)}</div> : <p className="rounded-2xl border border-overlay/10 bg-bg-elevated p-6 text-text-secondary"><T>The catalog is temporarily unavailable. Please try again soon.</T></p>}
        <nav aria-label="Catalog pagination" className="flex items-center justify-center gap-5">
          {hasPrevious ? <Link href={page === 2 ? '/apps/browse' : `/apps/browse?page=${page - 1}`} className="rounded-lg border border-overlay/10 bg-bg-elevated px-4 py-2 text-text-primary hover:border-accent-cyan/40"><T>Previous</T></Link> : <span className="rounded-lg border border-overlay/5 px-4 py-2 text-text-muted"><T>Previous</T></span>}
          <span className="text-sm text-text-secondary"><T>Page <Var>{page}</Var> of <Var>{totalPages}</Var></T></span>
          {hasNext ? <Link href={`/apps/browse?page=${page + 1}`} className="rounded-lg border border-overlay/10 bg-bg-elevated px-4 py-2 text-text-primary hover:border-accent-cyan/40"><T>Next</T></Link> : <span className="rounded-lg border border-overlay/5 px-4 py-2 text-text-muted"><T>Next</T></span>}
        </nav>
      </main>
      <Footer />
    </div>
  );
}
