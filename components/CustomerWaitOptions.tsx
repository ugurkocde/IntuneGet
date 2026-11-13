import Link from 'next/link';
import { T } from 'gt-next';
import { customerWaitOptions, type CustomerJobSnapshot, type WaitingCustomerJob } from '@/lib/customer-wait-options';

export function CustomerWaitOptions({ job, context, now = Date.now() }: { job: WaitingCustomerJob; context: CustomerJobSnapshot; now?: number }) {
  const options = customerWaitOptions(job, context, now);
  if (!options) return null;
  return (
    <div className="mt-4 rounded-lg border border-overlay/10 bg-bg-surface p-4 text-sm">
      <h4 className="font-semibold text-text-primary"><T>Review your options</T></h4>
      <p className="mt-2 text-text-secondary">
        {options.fromCreation
          ? <T>This request was created at least 72 hours ago.</T>
          : <T>Installation validation was requested at least 72 hours ago.</T>}
      </p>
      <p className="mt-1 text-text-secondary"><T>Review the catalog or packaging help. Apps and installers still need their usual checks.</T></p>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-accent-cyan">
        <li><Link href="/dashboard/apps" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"><T>Browse catalog</T></Link></li>
        <li><Link href="/docs/packaging" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"><T>Custom installer help</T></Link></li>
        <li><Link href="/docs/getting-started" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"><T>Getting started help</T></Link></li>
      </ul>
    </div>
  );
}
