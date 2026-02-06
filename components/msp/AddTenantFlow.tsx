'use client';

import { useState } from 'react';
import { Building2, ArrowRight, Copy, Check, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useManagedTenants } from '@/hooks/useManagedTenants';
import { cn } from '@/lib/utils';
import type { AddTenantFlowProps, MspManagedTenant } from '@/types/msp';

type Step = 'details' | 'consent';

export function AddTenantFlow({ onComplete, onCancel }: AddTenantFlowProps) {
  const [step, setStep] = useState<Step>('details');
  const [displayName, setDisplayName] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTenant, setCreatedTenant] = useState<MspManagedTenant | null>(null);
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { add } = useManagedTenants();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await add({
        display_name: displayName,
        notes: notes || undefined,
      });

      setCreatedTenant(result.tenant);
      setConsentUrl(result.consentUrl);
      setStep('consent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add tenant');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!consentUrl) return;

    try {
      await navigator.clipboard.writeText(consentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers that don't support clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = consentUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenConsent = () => {
    if (consentUrl) {
      window.open(consentUrl, '_blank');
    }
  };

  const handleComplete = () => {
    if (createdTenant && onComplete) {
      onComplete(createdTenant);
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-4 mb-8">
        <div className={cn(
          'flex items-center gap-2 text-sm',
          step === 'details' ? 'text-accent-cyan' : 'text-text-muted'
        )}>
          <span className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
            step === 'details' ? 'bg-accent-cyan text-black' : 'bg-black/10 text-text-secondary'
          )}>1</span>
          <span>Details</span>
        </div>
        <ArrowRight className="w-4 h-4 text-text-muted" />
        <div className={cn(
          'flex items-center gap-2 text-sm',
          step === 'consent' ? 'text-accent-cyan' : 'text-text-muted'
        )}>
          <span className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
            step === 'consent' ? 'bg-accent-cyan text-black' : 'bg-black/10 text-text-secondary'
          )}>2</span>
          <span>Consent</span>
        </div>
      </div>

      {step === 'details' && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="p-6 rounded-xl bg-black/5 border border-black/10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-accent-cyan/20 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-accent-cyan" />
              </div>
              <div>
                <h3 className="font-medium text-text-primary">Add Customer Tenant</h3>
                <p className="text-sm text-text-muted">Enter details about your customer's organization</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Display Name *
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g., Contoso Inc"
                  className="w-full px-3 py-2 bg-black/5 border border-black/10 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 focus:border-accent-cyan/50"
                  required
                  minLength={2}
                  maxLength={100}
                />
                <p className="mt-1 text-xs text-text-muted">
                  A friendly name to identify this customer
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional notes about this customer..."
                  rows={3}
                  className="w-full px-3 py-2 bg-black/5 border border-black/10 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 focus:border-accent-cyan/50 resize-none"
                  maxLength={500}
                />
              </div>
            </div>

            {error && (
              <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 justify-end">
            {onCancel && (
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                className="text-text-secondary hover:text-text-primary"
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              disabled={isSubmitting || displayName.trim().length < 2}
              className="bg-gradient-to-r from-accent-cyan to-accent-violet text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </form>
      )}

      {step === 'consent' && consentUrl && (
        <div className="space-y-6">
          <div className="p-6 rounded-xl bg-black/5 border border-black/10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <Check className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <h3 className="font-medium text-text-primary">Tenant Created</h3>
                <p className="text-sm text-text-muted">Now share the consent link with your customer</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-text-secondary mb-4">
                  Share this link with the customer's Microsoft 365 administrator. They need to grant consent for IntuneGet to manage applications in their tenant.
                </p>

                <div className="p-3 bg-black/5 rounded-lg border border-black/10">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={consentUrl}
                      readOnly
                      className="flex-1 bg-transparent text-sm text-text-secondary focus:outline-none truncate"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyUrl}
                      className="flex-shrink-0"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20">
                <h4 className="text-sm font-medium text-text-primary mb-2">What happens next?</h4>
                <ul className="text-sm text-text-secondary space-y-1">
                  <li>1. Send the consent URL to your customer's admin</li>
                  <li>2. They click the link and sign in with their admin account</li>
                  <li>3. They grant consent for IntuneGet permissions</li>
                  <li>4. The tenant will automatically appear as "Active" in your list</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenConsent}
              className="border-black/20 text-text-primary hover:bg-black/5"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open consent page
            </Button>
            <Button
              type="button"
              onClick={handleComplete}
              className="bg-gradient-to-r from-accent-cyan to-accent-violet text-white"
            >
              Done
            </Button>
          </div>
        </div>
      )}

      {step === 'consent' && !consentUrl && (
        <div className="space-y-6">
          <div className="p-6 rounded-xl bg-black/5 border border-black/10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-medium text-text-primary">Consent URL Unavailable</h3>
                <p className="text-sm text-text-muted">The tenant was created but the consent link could not be generated</p>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-text-secondary">
                The server could not generate a consent URL. This is usually caused by a missing server configuration.
                You can retrieve the consent URL later by selecting &quot;Get Consent URL&quot; from the tenant menu on the tenants page.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 justify-end">
            <Button
              type="button"
              onClick={handleComplete}
              className="bg-gradient-to-r from-accent-cyan to-accent-violet text-white"
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AddTenantFlow;
