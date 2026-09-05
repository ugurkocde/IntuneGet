import { isQaMaintenanceMode } from '@/lib/qa/maintenance';
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
  const maintenance = isQaMaintenanceMode();
  const host = (await headers()).get('host');
  if (!isQaLivePublicEnabled(host)) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-bg-deepest">
      <Header />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <main id="main-content" className="mx-auto min-h-svh w-full max-w-[1600px] flex-1 px-4 pb-16 pt-24 lg:px-8 lg:pt-28">
        <div className="mb-8 max-w-3xl space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent-cyan"><T>Application quality assurance</T></p>
          <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">{maintenance ? <T>Application QA</T> : <T>See package QA as it happens</T>}</h1>
          <p className="text-lg text-text-secondary">{maintenance ? <T>Automated application testing is temporarily paused. Customer uploads remain available.</T> : <T>Every update is installed, detected, uninstalled, and verified inside a clean Windows VM before it can be released through IntuneGet.</T>}</p>
        </div>
        {maintenance ? (
          <section className="rounded-2xl border border-overlay/10 bg-bg-elevated p-6 sm:p-8" aria-labelledby="qa-maintenance-heading">
            <h2 id="qa-maintenance-heading" className="text-xl font-semibold text-text-primary"><T>QA is temporarily paused</T></h2>
            <p className="mt-3 max-w-2xl text-text-secondary"><T>Customer uploads can proceed without an automated installation test during this pause. Live testing and results will return when QA resumes.</T></p>
          </section>
        ) : <QaLiveClient />}
      </main>
      <Footer />
    </div>
  );
}
