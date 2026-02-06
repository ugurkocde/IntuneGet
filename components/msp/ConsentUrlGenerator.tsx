'use client';

import { useState } from 'react';
import { Copy, Check, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ConsentUrlGeneratorProps } from '@/types/msp';

export function ConsentUrlGenerator({ tenantRecordId, consentUrl, onClose }: ConsentUrlGeneratorProps) {
  const [copied, setCopied] = useState(false);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-bg-surface border border-black/10 rounded-xl shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-black/5">
          <h3 className="text-lg font-medium text-text-primary">Consent URL</h3>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-black/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-text-secondary">
            Share this URL with your customer's Microsoft 365 administrator to grant consent for IntuneGet.
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

          <div className="p-3 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20 text-sm text-text-secondary">
            <p>
              Once the customer grants consent, their tenant will automatically become active in your MSP dashboard.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-black/5">
          <Button
            type="button"
            variant="outline"
            onClick={handleOpenConsent}
            className="border-black/20 text-text-primary hover:bg-black/5"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Open consent page
          </Button>
          {onClose && (
            <Button
              type="button"
              onClick={onClose}
              className="bg-black/10 text-text-primary hover:bg-black/20"
            >
              Close
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConsentUrlGenerator;
