'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Settings,
  Play,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useCartStore } from '@/stores/cart-store';
import { PageHeader } from '@/components/dashboard';
import type {
  SccmMigrationPreviewItem,
  SccmMigrationPreviewResponse,
  SccmMigrationResult,
  SccmMigrationOptions,
} from '@/types/sccm';
import type { CartItem } from '@/types/upload';

interface PageProps {
  params: Promise<{ migrationId: string }>;
}

export default function MigratePage({ params }: PageProps) {
  const resolvedParams = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getAccessToken } = useMicrosoftAuth();
  const addItem = useCartStore(state => state.addItem);
  const openCart = useCartStore(state => state.openCart);

  const [isLoading, setIsLoading] = useState(true);
  const [isMigrating, setIsMigrating] = useState(false);
  const [preview, setPreview] = useState<SccmMigrationPreviewResponse | null>(null);
  const [result, setResult] = useState<SccmMigrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const [options, setOptions] = useState<SccmMigrationOptions>({
    preserveDetection: true,
    preserveInstallCommands: false,
    useWingetDefaults: true,
    batchSize: 10,
    dryRun: false,
  });

  const appIds = searchParams.get('apps')?.split(',').filter(Boolean) || [];

  const fetchPreview = useCallback(async () => {
    if (appIds.length === 0) {
      setError('No apps selected for migration');
      setIsLoading(false);
      return;
    }

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Authentication required');

      const response = await fetch('/api/sccm/migrate?action=preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          migrationId: resolvedParams.migrationId,
          appIds,
          options,
        }),
      });

      if (!response.ok) throw new Error('Failed to generate preview');

      const data: SccmMigrationPreviewResponse = await response.json();
      setPreview(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, resolvedParams.migrationId, appIds, options]);

  useEffect(() => {
    fetchPreview();
  }, []);

  const handleMigrate = async () => {
    if (!preview) return;

    setIsMigrating(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Authentication required');

      const response = await fetch('/api/sccm/migrate?action=execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          migrationId: resolvedParams.migrationId,
          appIds: preview.items.filter(i => i.canMigrate).map(i => i.appId),
          options,
        }),
      });

      if (!response.ok) throw new Error('Migration failed');

      const data = await response.json();
      setResult(data);

      // Add cart items
      if (data.cartItems && Array.isArray(data.cartItems)) {
        for (const item of data.cartItems) {
          addItem(item);
        }
        openCart();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migration failed');
    } finally {
      setIsMigrating(false);
    }
  };

  const toggleExpand = (appId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(appId)) {
      newExpanded.delete(appId);
    } else {
      newExpanded.add(appId);
    }
    setExpandedItems(newExpanded);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="w-10 h-10 text-accent-cyan animate-spin mb-4" />
        <p className="text-text-secondary">Generating migration preview...</p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Migration Complete"
          description={`Successfully migrated ${result.successful} of ${result.totalAttempted} applications`}
          gradient
          gradientColors="cyan"
        />

        <div className="glass-light rounded-xl p-8 border border-black/5 text-center">
          <div className="w-20 h-20 mx-auto bg-status-success/10 rounded-xl flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10 text-status-success" />
          </div>

          <div className="grid grid-cols-3 gap-6 max-w-md mx-auto mb-8">
            <div>
              <p className="text-2xl font-bold text-status-success">{result.successful}</p>
              <p className="text-sm text-text-muted">Migrated</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-status-error">{result.failed}</p>
              <p className="text-sm text-text-muted">Failed</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-text-secondary">{result.skipped}</p>
              <p className="text-sm text-text-muted">Skipped</p>
            </div>
          </div>

          <p className="text-text-secondary mb-6">
            Applications have been added to your cart for deployment to Intune.
          </p>

          <div className="flex items-center justify-center gap-4">
            <Link href={`/dashboard/sccm/${resolvedParams.migrationId}`}>
              <Button variant="outline" className="border-black/10 text-text-secondary">
                Back to Migration
              </Button>
            </Link>
            <Link href="/dashboard/uploads">
              <Button className="bg-gradient-to-r from-accent-cyan to-accent-violet">
                View Cart
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/dashboard/sccm/${resolvedParams.migrationId}`}>
          <Button variant="ghost" size="sm" className="text-text-secondary hover:text-text-primary">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>

      <PageHeader
        title="Migration Preview"
        description={`Review ${preview?.totalApps || 0} apps before migrating to Intune`}
        gradient
        gradientColors="violet"
      />

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-start gap-3 p-4 bg-status-error/10 border border-status-error/20 rounded-lg"
          >
            <AlertCircle className="w-5 h-5 text-status-error flex-shrink-0" />
            <p className="text-status-error text-sm">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Options */}
      <div className="glass-light rounded-xl p-6 border border-black/5">
        <h3 className="text-text-primary font-medium mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-text-secondary" />
          Migration Options
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="flex items-center gap-3 p-3 bg-black/5 rounded-lg cursor-pointer hover:bg-black/10 transition-colors">
            <input
              type="checkbox"
              checked={options.preserveDetection}
              onChange={(e) => setOptions(prev => ({ ...prev, preserveDetection: e.target.checked }))}
              className="rounded border-black/20"
            />
            <div>
              <p className="text-text-primary text-sm font-medium">Preserve Detection Rules</p>
              <p className="text-text-muted text-xs">Use SCCM detection rules when possible</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 bg-black/5 rounded-lg cursor-pointer hover:bg-black/10 transition-colors">
            <input
              type="checkbox"
              checked={options.preserveInstallCommands}
              onChange={(e) => setOptions(prev => ({ ...prev, preserveInstallCommands: e.target.checked }))}
              className="rounded border-black/20"
            />
            <div>
              <p className="text-text-primary text-sm font-medium">Preserve Commands</p>
              <p className="text-text-muted text-xs">Use SCCM install/uninstall commands</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 bg-black/5 rounded-lg cursor-pointer hover:bg-black/10 transition-colors">
            <input
              type="checkbox"
              checked={options.useWingetDefaults}
              onChange={(e) => setOptions(prev => ({ ...prev, useWingetDefaults: e.target.checked }))}
              className="rounded border-black/20"
            />
            <div>
              <p className="text-text-primary text-sm font-medium">WinGet Defaults</p>
              <p className="text-text-muted text-xs">Fall back to WinGet package defaults</p>
            </div>
          </label>
        </div>
      </div>

      {/* Summary */}
      {preview && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="glass-light rounded-lg p-4 border border-black/5">
            <p className="text-text-muted text-sm">Total</p>
            <p className="text-2xl font-bold text-text-primary">{preview.totalApps}</p>
          </div>
          <div className="glass-light rounded-lg p-4 border border-status-success/20">
            <p className="text-text-muted text-sm">Ready to Migrate</p>
            <p className="text-2xl font-bold text-status-success">{preview.migratable}</p>
          </div>
          <div className="glass-light rounded-lg p-4 border border-status-error/20">
            <p className="text-text-muted text-sm">Blocked</p>
            <p className="text-2xl font-bold text-status-error">{preview.blocked}</p>
          </div>
          <div className="glass-light rounded-lg p-4 border border-status-warning/20">
            <p className="text-text-muted text-sm">Warnings</p>
            <p className="text-2xl font-bold text-status-warning">{preview.warnings.length}</p>
          </div>
        </div>
      )}

      {/* Preview Items */}
      {preview && (
        <div className="space-y-2">
          {preview.items.map(item => (
            <PreviewItem
              key={item.appId}
              item={item}
              isExpanded={expandedItems.has(item.appId)}
              onToggle={() => toggleExpand(item.appId)}
            />
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-black/5">
        <Link href={`/dashboard/sccm/${resolvedParams.migrationId}`}>
          <Button variant="outline" className="border-black/10 text-text-secondary">
            Cancel
          </Button>
        </Link>

        <Button
          onClick={handleMigrate}
          disabled={isMigrating || !preview || preview.migratable === 0}
          className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90"
        >
          {isMigrating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Migrating...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Migrate {preview?.migratable || 0} Apps
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function PreviewItem({
  item,
  isExpanded,
  onToggle,
}: {
  item: SccmMigrationPreviewItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        'border rounded-lg transition-all',
        item.canMigrate
          ? 'border-black/5 bg-black/2 hover:border-black/10'
          : 'border-status-error/20 bg-status-error/5'
      )}
    >
      <div
        className="flex items-center gap-4 p-4 cursor-pointer"
        onClick={onToggle}
      >
        <div className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
          item.canMigrate ? 'bg-status-success/10' : 'bg-status-error/10'
        )}>
          {item.canMigrate ? (
            <CheckCircle2 className="w-5 h-5 text-status-success" />
          ) : (
            <AlertCircle className="w-5 h-5 text-status-error" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h4 className="text-text-primary font-medium truncate">{item.sccmName}</h4>
            {item.warnings.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-status-warning">
                <AlertTriangle className="w-3 h-3" />
                {item.warnings.length} warning{item.warnings.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          {item.canMigrate && (
            <p className="text-text-muted text-sm mt-0.5">
              {item.wingetId} - Detection: {item.detectionSource}, Commands: {item.commandSource}
            </p>
          )}
          {!item.canMigrate && item.blockingReasons && (
            <p className="text-status-error/70 text-sm mt-0.5">
              {item.blockingReasons.join(', ')}
            </p>
          )}
        </div>

        <button className="text-text-muted hover:text-text-primary">
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-2 border-t border-black/5 space-y-3">
              {item.warnings.length > 0 && (
                <div className="p-3 bg-status-warning/10 border border-status-warning/20 rounded-lg">
                  <p className="text-status-warning text-sm font-medium mb-1">Warnings:</p>
                  <ul className="text-status-warning/70 text-sm list-disc list-inside">
                    {item.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {item.canMigrate && (
                <>
                  <div>
                    <p className="text-text-muted text-xs mb-1">Install Command</p>
                    <code className="text-xs text-text-secondary bg-black/5 px-2 py-1 rounded block truncate">
                      {item.installCommand || 'Default WinGet command'}
                    </code>
                  </div>
                  <div>
                    <p className="text-text-muted text-xs mb-1">Detection Rules ({item.detectionRules.length})</p>
                    {item.detectionRules.slice(0, 2).map((rule, i) => (
                      <code key={i} className="text-xs text-text-secondary bg-black/5 px-2 py-1 rounded block truncate mb-1">
                        {rule.type}: {JSON.stringify(rule).slice(0, 100)}...
                      </code>
                    ))}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
