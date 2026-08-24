import Link from 'next/link';
import { T, Var } from 'gt-next';
import { appCatalogHref } from '@/lib/catalog/seo';

/**
 * Static strip of flagship app detail pages. Used on blog posts and docs to
 * deep-link the catalog's strongest pages; kept static so the strip renders
 * even when the catalog source is unavailable.
 */
const FLAGSHIP_APPS: { wingetId: string; name: string }[] = [
  { wingetId: 'Google.Chrome', name: 'Google Chrome' },
  { wingetId: 'Adobe.Acrobat.Reader.64-bit', name: 'Adobe Acrobat Reader' },
  { wingetId: 'Mozilla.Firefox', name: 'Mozilla Firefox' },
  { wingetId: 'Microsoft.VisualStudioCode', name: 'Visual Studio Code' },
  { wingetId: '7zip.7zip', name: '7-Zip' },
  { wingetId: 'VideoLAN.VLC', name: 'VLC media player' },
  { wingetId: 'Zoom.Zoom', name: 'Zoom Workplace' },
  { wingetId: 'Notepad++.Notepad++', name: 'Notepad++' },
];

export function PopularAppLinks() {
  return (
    <section className="rounded-2xl border border-overlay/10 bg-bg-elevated p-6 space-y-4">
      <h2 className="text-xl font-semibold text-text-primary">
        <T>Deploy these apps with IntuneGet</T>
      </h2>
      <p className="text-sm text-text-secondary">
        <T>
          Each page shows the verified silent install commands, detection rules,
          and QA results for that app.
        </T>
      </p>
      <div className="flex flex-wrap gap-2.5">
        {FLAGSHIP_APPS.map((app) => (
          <Link
            key={app.wingetId}
            href={appCatalogHref(app.wingetId)}
            className="rounded-lg border border-overlay/10 bg-bg-surface px-3.5 py-2 text-sm font-medium text-text-primary transition-colors hover:border-accent-cyan/40 hover:text-accent-cyan"
          >
            <Var>{app.name}</Var>
          </Link>
        ))}
        <Link
          href="/apps"
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-accent-cyan hover:underline"
        >
          <T>Browse the full catalog</T>
        </Link>
      </div>
    </section>
  );
}
