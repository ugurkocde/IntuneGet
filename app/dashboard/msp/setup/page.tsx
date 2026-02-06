'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Building2,
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
  Shield,
  Users,
  Package,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMsp } from '@/contexts/MspContext';
import { generateSlug } from '@/types/msp';
import { cn } from '@/lib/utils';

export default function MspSetupPage() {
  const router = useRouter();
  const { isMspUser, isLoadingOrganization, createOrganization } = useMsp();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [useCustomSlug, setUseCustomSlug] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already an MSP user
  useEffect(() => {
    if (!isLoadingOrganization && isMspUser) {
      router.push('/dashboard/msp');
    }
  }, [isLoadingOrganization, isMspUser, router]);

  // Auto-generate slug from name
  useEffect(() => {
    if (!useCustomSlug && name) {
      setSlug(generateSlug(name));
    }
  }, [name, useCustomSlug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await createOrganization({
        name,
        slug: useCustomSlug ? slug : undefined,
      });
      router.push('/dashboard/msp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (isLoadingOrganization) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-accent-cyan animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading...</p>
        </div>
      </div>
    );
  }

  // Already an MSP user
  if (isMspUser) {
    return null;
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-cyan/20 to-accent-violet/20 mb-4">
          <Building2 className="w-8 h-8 text-accent-cyan" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary mb-2">Set Up MSP Mode</h1>
        <p className="text-text-muted">
          Manage multiple customer Intune tenants from a single dashboard
        </p>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="p-4 rounded-xl bg-black/5 border border-black/10 text-center">
          <Users className="w-6 h-6 text-accent-cyan mx-auto mb-2" />
          <p className="text-sm font-medium text-text-primary">Multi-Tenant</p>
          <p className="text-xs text-text-muted mt-1">Manage all customers</p>
        </div>
        <div className="p-4 rounded-xl bg-black/5 border border-black/10 text-center">
          <Package className="w-6 h-6 text-accent-violet mx-auto mb-2" />
          <p className="text-sm font-medium text-text-primary">Unified Deployment</p>
          <p className="text-xs text-text-muted mt-1">Deploy apps anywhere</p>
        </div>
        <div className="p-4 rounded-xl bg-black/5 border border-black/10 text-center">
          <Shield className="w-6 h-6 text-green-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-text-primary">Secure</p>
          <p className="text-xs text-text-muted mt-1">Consent-based access</p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="p-6 rounded-xl bg-black/5 border border-black/10">
          <h2 className="text-lg font-medium text-text-primary mb-4">Organization Details</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Organization Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Acme IT Services"
                className="w-full px-3 py-2 bg-black/5 border border-black/10 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 focus:border-accent-cyan/50"
                required
                minLength={2}
                maxLength={100}
              />
              <p className="mt-1 text-xs text-text-muted">
                Your MSP company name
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Organization Slug
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
                    setUseCustomSlug(true);
                  }}
                  placeholder="acme-it-services"
                  className={cn(
                    "flex-1 px-3 py-2 bg-black/5 border border-black/10 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 focus:border-accent-cyan/50",
                    !useCustomSlug && "text-text-muted"
                  )}
                />
                {useCustomSlug && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setUseCustomSlug(false);
                      setSlug(generateSlug(name));
                    }}
                    className="text-text-secondary hover:text-text-primary"
                  >
                    Auto
                  </Button>
                )}
              </div>
              <p className="mt-1 text-xs text-text-muted">
                URL-friendly identifier (auto-generated from name)
              </p>
            </div>
          </div>
        </div>

        {/* Info box */}
        <div className="p-4 rounded-xl bg-accent-cyan/10 border border-accent-cyan/20">
          <h3 className="text-sm font-medium text-text-primary mb-2">What happens next?</h3>
          <ul className="text-sm text-text-secondary space-y-1">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-accent-cyan mt-0.5 flex-shrink-0" />
              Your MSP organization will be created
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-accent-cyan mt-0.5 flex-shrink-0" />
              Your current tenant will be added as the primary tenant
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-accent-cyan mt-0.5 flex-shrink-0" />
              You can then invite customer tenants via consent links
            </li>
          </ul>
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <Link href="/dashboard">
            <Button
              type="button"
              variant="ghost"
              className="text-text-secondary hover:text-text-primary"
            >
              Cancel
            </Button>
          </Link>
          <Button
            type="submit"
            disabled={isSubmitting || name.trim().length < 2}
            className="bg-gradient-to-r from-accent-cyan to-accent-violet text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Create MSP Organization
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
