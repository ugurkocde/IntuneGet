import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { T } from 'gt-next';
import { Header } from '@/components/landing/Header';
import { Footer } from '@/components/landing/sections/Footer';
import { QaLiveClient } from './QaLiveClient';
import { isQaLivePublicEnabled } from '@/lib/qa/public-access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Live Application QA - IntuneGet',
  description: 'Follow IntuneGet application package quality assurance in real time, from isolated installation through detection and uninstall verification.',
  alternates: { canonical: 'https://intuneget.com/qa' },
};

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://intuneget.com' },
    { '@type': 'ListItem', position: 2, name: 'Application QA', item: 'https://intuneget.com/qa' },
  ],
};

export default async function QaPage() {
  const host = (await headers()).get('host');
  if (!isQaLivePublicEnabled(host)) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-bg-deepest">
      <Header />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-24 lg:px-8 lg:pt-28">
        <div className="mb-8 max-w-3xl space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent-cyan"><T>Application quality assurance</T></p>
          <h1 className="text-3xl font-bold text-text-primary sm:text-4xl"><T>See package QA as it happens</T></h1>
          <p className="text-lg text-text-secondary"><T>Every update is installed, detected, uninstalled, and verified inside a clean Windows VM before it can be released through IntuneGet.</T></p>
        </div>
        <QaLiveClient />
      </main>
      <Footer />
    </div>
  );
}
