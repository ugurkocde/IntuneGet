'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowRight } from 'lucide-react';
import { T } from 'gt-next';

const QaDetailsDialog = dynamic(
  () => import('./QaDetailsDialog').then((module) => module.QaDetailsDialog),
  { ssr: false }
);

interface QaReportButtonProps {
  wingetId: string;
  catalogVersion: string;
  packageProfileSha256?: string;
}

export function QaReportButton({ wingetId, catalogVersion, packageProfileSha256 }: QaReportButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-sm font-medium text-accent-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elevated"
      >
        <T>View the full QA report</T>
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <QaDetailsDialog
        wingetId={wingetId}
        catalogVersion={catalogVersion}
        packageProfileSha256={packageProfileSha256}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
