import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { T, Var } from 'gt-next';

export function CatalogCta({ appName }: { appName?: string }) {
  return (
    <section className="space-y-4 rounded-2xl border border-overlay/10 bg-bg-elevated p-8 text-center">
      <h2 className="text-2xl font-bold text-text-primary">
        {appName ? <T>Deploy <Var>{appName}</Var> to your tenant</T> : <T>Deploy apps to your tenant</T>}
      </h2>
      <p className="mx-auto max-w-xl text-text-secondary">
        <T>Sign in with your Microsoft work account, choose your apps, and let IntuneGet prepare the deployment.</T>
      </p>
      <Link
        href="/auth/signin"
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-cyan px-8 py-4 text-base font-semibold text-white shadow-glow-cyan transition-all duration-300 hover:bg-accent-cyan-dim hover:shadow-glow-cyan-lg"
      >
        <T>Start deploying free</T>
        <ArrowRight className="h-5 w-5" />
      </Link>
    </section>
  );
}
