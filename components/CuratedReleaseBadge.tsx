import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { T } from 'gt-next';

export function CuratedReleaseBadge({ appId }: { appId: string }) {
  return (
    <Link
      href={`/dashboard/apps/curated#${encodeURIComponent(appId)}`}
      prefetch={false}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-full border border-accent-cyan/30 bg-accent-cyan/10 px-2 py-0.5 text-xs font-medium text-accent-cyan hover:bg-accent-cyan/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
    >
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      <T>Curated release available</T>
    </Link>
  );
}
