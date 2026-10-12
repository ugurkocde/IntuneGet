import Link from 'next/link';
import { T, Var } from 'gt-next';
import { AppIcon } from '@/components/AppIcon';
import { appCatalogHref } from '@/lib/catalog/seo';
import type { PopularCuratedAppRow } from '@/lib/catalog/types';

export function CatalogAppCard({ app }: { app: PopularCuratedAppRow }) {
  return (
    <Link
      href={appCatalogHref(app.winget_id)}
      className="group flex items-center gap-4 rounded-2xl border border-overlay/10 bg-bg-elevated p-4 transition-colors hover:border-accent-cyan/40 hover:bg-bg-surface"
    >
      <AppIcon
        packageId={app.winget_id}
        packageName={app.name}
        iconPath={app.icon_path ?? undefined}
        size="lg"
      />
      <div className="min-w-0">
        <p className="truncate font-medium text-text-primary group-hover:text-accent-cyan">
          <T><Var>{app.name}</Var></T>
        </p>
        <p className="truncate text-sm text-text-muted"><T><Var>{app.publisher}</Var></T></p>
      </div>
      <span className="sr-only"><T>View deployment details</T></span>
    </Link>
  );
}
