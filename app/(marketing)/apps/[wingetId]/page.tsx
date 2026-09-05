import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { T, Var } from 'gt-next';
import type { ReactNode } from 'react';
import { Header } from '@/components/landing/Header';
import { Footer } from '@/components/landing/sections/Footer';
import { AppIcon } from '@/components/AppIcon';
import { CatalogAppCard } from '@/components/catalog/CatalogAppCard';
import { CatalogCta } from '@/components/catalog/CatalogCta';
import { getCatalogSource } from '@/lib/catalog';
import {
  absoluteAppCatalogUrl,
  appCatalogHref,
  categoryDisplayName,
  categorySlug,
  resolveCatalogIconUrl,
} from '@/lib/catalog/seo';

export const dynamicParams = true;
export const revalidate = 86400;

type PageProps = { params: Promise<{ wingetId: string }> };

function decodeWingetId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    notFound();
  }
}

const resolveApp = cache(async (encodedId: string) => {
  const id = decodeWingetId(encodedId);
  const source = getCatalogSource();
  const details = await source.getAppByWingetId(id, { presentationOnly: true }).catch(() => null);
  if (!details) {
    const canonical = await source.appExistsCaseInsensitive(id).catch(() => null);
    if (canonical) permanentRedirect(appCatalogHref(canonical.winget_id));
    notFound();
  }
  if (details.app.is_locale_variant && details.app.parent_winget_id) {
    permanentRedirect(appCatalogHref(details.app.parent_winget_id));
  }
  return details;
});

export async function generateStaticParams() {
  return getCatalogSource()
    .getVerifiedAppIds(100)
    .then((apps) => apps.map((app) => ({ wingetId: app.winget_id })))
    .catch(() => []);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { wingetId } = await params;
  const { app } = await resolveApp(wingetId);
  const publisher = app.publisher || 'its publisher';
  return {
    title: `Deploy ${app.name} to Microsoft Intune - IntuneGet`,
    description: `Deploy ${app.name} from ${publisher} with IntuneGet, which packages and uploads it to Microsoft Intune automatically.`,
    alternates: { canonical: absoluteAppCatalogUrl(app.winget_id) },
    robots: app.is_verified === true ? undefined : { index: false, follow: true },
  };
}

// Maps the catalog's category slugs to schema.org ApplicationCategory values.
const schemaCategory: Record<string, string> = {
  audio: 'MultimediaApplication',
  automation: 'DeveloperApplication',
  backup: 'UtilitiesApplication',
  browser: 'BrowserApplication',
  business: 'BusinessApplication',
  'cloud-storage': 'UtilitiesApplication',
  collaboration: 'CommunicationApplication',
  communication: 'CommunicationApplication',
  database: 'DeveloperApplication',
  design: 'DesignApplication',
  'developer-tools': 'DeveloperApplication',
  devops: 'DeveloperApplication',
  education: 'EducationalApplication',
  finance: 'FinanceApplication',
  gaming: 'GameApplication',
  graphics: 'MultimediaApplication',
  ide: 'DeveloperApplication',
  media: 'MultimediaApplication',
  monitoring: 'UtilitiesApplication',
  networking: 'UtilitiesApplication',
  office: 'BusinessApplication',
  'package-management': 'DeveloperApplication',
  photo: 'MultimediaApplication',
  productivity: 'BusinessApplication',
  runtime: 'UtilitiesApplication',
  security: 'SecurityApplication',
  system: 'UtilitiesApplication',
  utilities: 'UtilitiesApplication',
  video: 'MultimediaApplication',
  virtualization: 'UtilitiesApplication',
};

export default async function AppDetailPage({ params }: PageProps) {
  const { wingetId } = await params;
  const details = await resolveApp(wingetId);
  const { app, versions } = details;
  const source = getCatalogSource();
  const [qa, changelog, installer, relatedResult] = await Promise.all([
    source.getQaResult(app.winget_id).catch(() => null),
    source.getInstallationChangelog(app.winget_id).catch(() => null),
    app.latest_version
      ? source.getVersionInstallerInfo(app.winget_id, app.latest_version).catch(() => null)
      : Promise.resolve(null),
    app.category
      ? source.getPopularApps({ limit: 7, offset: 0, category: app.category, sort: 'popular' }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const related = (relatedResult?.data ?? []).filter((item) => item.winget_id !== app.winget_id).slice(0, 6);
  const category = app.category || null;
  const categoryName = category ? categoryDisplayName(category) : null;
  const categoryHref = category ? `/apps/category/${categorySlug(category)}` : null;
  const recentVersions = versions.slice(0, 10);
  const appSource = app.app_source === 'store' ? 'Microsoft Store' : app.app_source === 'winget' ? 'WinGet' : app.app_source;
  const applicationCategory = category ? schemaCategory[categorySlug(category)] : undefined;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://intuneget.com' },
      { '@type': 'ListItem', position: 2, name: 'App Catalog', item: 'https://intuneget.com/apps' },
      { '@type': 'ListItem', position: 3, name: app.name, item: absoluteAppCatalogUrl(app.winget_id) },
    ],
  };
  const softwareJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: app.name,
    publisher: { '@type': 'Organization', name: app.publisher },
    ...(app.latest_version ? { softwareVersion: app.latest_version } : {}),
    operatingSystem: 'Windows',
    ...(applicationCategory ? { applicationCategory } : {}),
    ...(app.license ? { license: app.license } : {}),
    image: resolveCatalogIconUrl(app),
  };

  // Prefer values captured during a passed QA run: those commands were actually
  // executed in an isolated VM with the reviewed packaging adapters applied,
  // while version_history values come from the WinGet manifest.
  const qaVerified = qa?.outcome === 'Passed';
  const installerType = (qaVerified ? qa.installer_type : null) ?? installer?.installer_type;
  const silentArgs =
    (qaVerified ? qa.effective_configuration?.vendorSilentArguments : null) ?? installer?.silent_args;
  const installCommand = qaVerified ? qa.install_command : null;
  // uninstall_command can hold the internal REGISTRY_UNINSTALL sentinel, which
  // means the package replays the app's own registered uninstaller.
  const rawUninstall = qaVerified ? qa.uninstall_command : null;
  const uninstallCommand = rawUninstall && !rawUninstall.startsWith('REGISTRY_UNINSTALL') ? rawUninstall : null;
  const usesRegisteredUninstaller = !!rawUninstall && rawUninstall.startsWith('REGISTRY_UNINSTALL');

  const deploymentRows: { label: ReactNode; value: ReactNode; code?: boolean }[] = [];
  if (app.latest_version) deploymentRows.push({ label: <T>Latest version</T>, value: app.latest_version });
  if (installerType) deploymentRows.push({ label: <T>Installer type</T>, value: installerType });
  if (installer?.installer_scope) deploymentRows.push({ label: <T>Install scope</T>, value: installer.installer_scope });
  if (silentArgs) deploymentRows.push({ label: <T>Silent install arguments</T>, value: silentArgs, code: true });
  if (installCommand) deploymentRows.push({ label: <T>Install command</T>, value: installCommand, code: true });
  if (uninstallCommand) deploymentRows.push({ label: <T>Uninstall command</T>, value: uninstallCommand, code: true });
  if (usesRegisteredUninstaller) deploymentRows.push({ label: <T>Uninstall</T>, value: <T>Uses the app&apos;s own registered uninstaller</T> });
  const detection = qaVerified ? qa.detection : null;
  if (detection?.type === 'fileVersion' && detection.path) {
    deploymentRows.push({
      label: <T>Detection rule</T>,
      value: (
        <T>
          File version at <Var><code className="rounded bg-bg-deepest px-1.5 py-0.5 text-sm">{detection.path}</code></Var> must be at least <Var>{detection.minimumVersion}</Var>
        </T>
      ),
    });
  } else if (detection?.description) {
    deploymentRows.push({ label: <T>Detection rule</T>, value: <Var>{detection.description}</Var> });
  }
  if (appSource) deploymentRows.push({ label: <T>App source</T>, value: appSource });

  // Hash-only VirusTotal verdict recorded alongside the QA run. Informational;
  // only surface the states that mean something to a reader.
  const virusTotal =
    qa?.virustotal_status && ['clean', 'suspicious', 'flagged'].includes(qa.virustotal_status)
      ? {
          status: qa.virustotal_status,
          flagged: (qa.virustotal_malicious ?? 0) + (qa.virustotal_suspicious ?? 0),
          engines: qa.virustotal_total_engines ?? null,
        }
      : null;

  return (
    <div className="flex min-h-screen flex-col bg-bg-deepest">
      <Header />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }} />
      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 space-y-10 px-4 pb-16 pt-24 lg:px-8 lg:pt-28">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <Link href="/" className="hover:text-accent-cyan"><T>Home</T></Link><span>/</span>
          <Link href="/apps" className="hover:text-accent-cyan"><T>App Catalog</T></Link><span>/</span>
          <span className="text-text-secondary"><Var>{app.name}</Var></span>
        </nav>

        <header className="space-y-3">
          <h1 className="text-3xl font-bold text-text-primary sm:text-4xl"><T>Deploy <Var>{app.name}</Var> to Microsoft Intune</T></h1>
          <p className="text-lg text-text-secondary"><T>Published by <Var>{app.publisher}</Var>{categoryName ? <> in <Var>{categoryName}</Var></> : null}</T></p>
        </header>

        <section className="rounded-2xl border border-overlay/10 bg-bg-elevated p-6">
          <div className="flex flex-col gap-5 sm:flex-row">
            <AppIcon packageId={app.winget_id} packageName={app.name} iconPath={app.icon_path} size="2xl" />
            <div className="min-w-0 space-y-4">
              {app.description && <p className="text-text-secondary"><Var>{app.description}</Var></p>}
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-text-muted"><T>Publisher</T></dt><dd className="text-text-primary"><Var>{app.publisher}</Var></dd></div>
                {app.homepage && <div><dt className="text-text-muted"><T>Homepage</T></dt><dd><a href={app.homepage} target="_blank" rel="noopener nofollow" className="inline-flex items-center gap-1 text-accent-cyan hover:underline"><T>Visit publisher website</T><ExternalLink className="h-3.5 w-3.5" /></a></dd></div>}
                {app.license && <div><dt className="text-text-muted"><T>License</T></dt><dd className="text-text-primary"><Var>{app.license}</Var></dd></div>}
                {categoryName && <div><dt className="text-text-muted"><T>Category</T></dt><dd className="text-text-primary">{categoryHref ? <Link href={categoryHref} className="text-accent-cyan hover:underline"><Var>{categoryName}</Var></Link> : <Var>{categoryName}</Var>}</dd></div>}
              </dl>
            </div>
          </div>
        </section>

        {deploymentRows.length > 0 && <section className="space-y-5"><h2 className="text-2xl font-semibold text-text-primary"><T>Deployment details</T></h2><dl className="divide-y divide-overlay/10 rounded-2xl border border-overlay/10 bg-bg-elevated px-6">{deploymentRows.map((row, index) => <div key={index} className="grid gap-1 py-4 sm:grid-cols-3"><dt className="text-text-muted">{row.label}</dt><dd className="sm:col-span-2 text-text-primary">{row.code ? <code className="rounded bg-bg-deepest px-2 py-1 text-sm"><Var>{row.value}</Var></code> : <Var>{row.value}</Var>}</dd></div>)}</dl>{qaVerified ? <p className="flex items-center gap-2 text-sm text-text-muted"><CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" aria-hidden="true" /><T>Commands and arguments were captured during an automated QA install of version <Var>{qa.tested_version}</Var> in an isolated Windows VM.</T></p> : <p className="text-sm text-text-muted">{qa ? <T>Values come from the WinGet community manifest.</T> : <T>Values come from the WinGet community manifest. This app has not completed an IntuneGet QA run yet.</T>}</p>}{changelog?.install_path && <p className="text-sm text-text-muted"><T>Observed install path: <Var>{changelog.install_path}</Var></T></p>}</section>}

        {qa && <section className="space-y-4 rounded-2xl border border-overlay/10 bg-bg-elevated p-6"><h2 className="text-2xl font-semibold text-text-primary"><T>Tested by IntuneGet QA</T></h2><div className="flex items-center gap-2">{qa.outcome === 'Passed' ? <CheckCircle2 className="h-5 w-5 text-green-400" /> : <XCircle className="h-5 w-5 text-red-400" />}<span className="font-medium text-text-primary"><Var>{qa.outcome}</Var></span></div><p className="text-sm text-text-secondary"><T>Version <Var>{qa.tested_version}</Var> tested on <Var>{new Date(qa.tested_at_utc).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}</Var>.</T></p>{virusTotal && <p className="text-sm text-text-secondary">{virusTotal.status === 'clean' ? <T>VirusTotal scan of the installer hash: clean{virusTotal.engines ? <>. 0 of <Var>{virusTotal.engines}</Var> engines flagged it</> : null}.</T> : <T>VirusTotal scan of the installer hash: <Var>{virusTotal.flagged}</Var> of <Var>{virusTotal.engines ?? 'the'}</Var> engines flagged it.</T>}</p>}</section>}

        {recentVersions.length > 0 && <section className="space-y-4"><h2 className="text-2xl font-semibold text-text-primary"><T>Recent versions</T></h2><ol className="flex flex-wrap gap-2">{recentVersions.map((version) => <li key={version} className="rounded-lg border border-overlay/10 bg-bg-elevated px-3 py-1.5 font-mono text-sm text-text-secondary"><Var>{version}</Var></li>)}</ol></section>}

        <section className="space-y-3"><h2 className="text-2xl font-semibold text-text-primary"><T>How deployment works</T></h2><p className="max-w-3xl text-text-secondary"><T>IntuneGet packages <Var>{app.name}</Var> as a Win32 app and uploads it directly to your Microsoft Intune tenant. You review the package settings, configure assignments, and start the deployment from one guided workflow.</T></p></section>
        <CatalogCta appName={app.name} />

        <section className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-2xl font-semibold text-text-primary"><T>Related apps</T></h2><div className="flex gap-4 text-sm">{categoryHref && <Link href={categoryHref} className="text-accent-cyan hover:underline"><T>Browse <Var>{categoryName}</Var></T></Link>}<Link href="/apps" className="text-accent-cyan hover:underline"><T>View app catalog</T></Link></div></div>{related.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{related.map((item) => <CatalogAppCard key={item.winget_id} app={item} />)}</div>}</section>
      </main>
      <Footer />
    </div>
  );
}
