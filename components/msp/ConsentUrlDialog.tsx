'use client';

import { useState } from 'react';
import { X, Copy, Check, ExternalLink, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ConsentUrlDialogProps {
  isOpen: boolean;
  onClose: () => void;
  consentUrl: string;
  tenantName: string;
}

export function ConsentUrlDialog({
  isOpen,
  onClose,
  consentUrl,
  tenantName,
}: ConsentUrlDialogProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyUrl = async () => {
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
    window.open(consentUrl, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-lg mx-4 bg-bg-elevated border border-black/10 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-black/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-cyan/20 flex items-center justify-center">
              <Link2 className="w-5 h-5 text-accent-cyan" />
            </div>
            <div>
              <h3 className="font-medium text-text-primary">Consent URL</h3>
              <p className="text-sm text-text-muted">{tenantName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-black/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-text-secondary">
            Share this link with the customer&apos;s Microsoft 365 administrator.
            They need to grant consent for IntuneGet to manage applications in their tenant.
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

          <div className="p-4 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20">
            <h4 className="text-sm font-medium text-text-primary mb-2">What happens next?</h4>
            <ul className="text-sm text-text-secondary space-y-1">
              <li>1. Send the consent URL to your customer&apos;s admin</li>
              <li>2. They click the link and sign in with their admin account</li>
              <li>3. They grant consent for IntuneGet permissions</li>
              <li>4. The tenant will automatically appear as &quot;Active&quot; in your list</li>
            </ul>
          </div>

          <p className="text-xs text-text-muted">
            Note: The consent URL expires after 1 hour. You can generate a new one anytime from the tenant menu.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 justify-end p-4 border-t border-black/10">
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
            onClick={onClose}
            className="bg-gradient-to-r from-accent-cyan to-accent-violet text-white"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ConsentUrlDialog;
