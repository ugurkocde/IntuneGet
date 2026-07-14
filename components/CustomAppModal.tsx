'use client';

import { useState, useEffect } from 'react';
import { X, FilePlus2, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useCartStore } from '@/stores/cart-store';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import {
  buildCustomAppCartItem,
  buildCustomWingetId,
  isValidInstallerUrl,
  isValidSha256,
  isValidIconUrl,
  CUSTOM_SILENT_SWITCH_DEFAULTS,
  type CustomInstallerType,
} from '@/lib/custom-app';
import type { WingetArchitecture, WingetScope } from '@/types/winget';

interface CustomAppModalProps {
  onClose: () => void;
}

const INSTALLER_TYPE_OPTIONS: { value: CustomInstallerType; label: string }[] = [
  { value: 'exe', label: 'EXE (generic installer)' },
  { value: 'msi', label: 'MSI (Windows Installer)' },
  { value: 'inno', label: 'Inno Setup' },
  { value: 'nullsoft', label: 'Nullsoft (NSIS)' },
  { value: 'burn', label: 'Burn (WiX bundle)' },
];

// Visual overrides on top of the shared Input base; also applied to the raw
// select/textarea so all fields in this form match.
const inputClassName =
  'flex h-auto w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm placeholder:text-text-muted shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan';

export function CustomAppModal({ onClose }: CustomAppModalProps) {
  // Required fields
  const [displayName, setDisplayName] = useState('');
  const [publisher, setPublisher] = useState('');
  const [version, setVersion] = useState('');
  const [installerUrl, setInstallerUrl] = useState('');
  const [installerType, setInstallerType] = useState<CustomInstallerType>('exe');
  const [architecture, setArchitecture] = useState<WingetArchitecture>('x64');
  const [installScope, setInstallScope] = useState<WingetScope>('machine');
  const [sha256, setSha256] = useState('');

  // Optional fields
  const [silentSwitches, setSilentSwitches] = useState(CUSTOM_SILENT_SWITCH_DEFAULTS.exe);
  const [uninstallCommand, setUninstallCommand] = useState('');
  const [description, setDescription] = useState('');
  const [iconUrl, setIconUrl] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isAdding, setIsAdding] = useState(false);

  const addItem = useCartStore((state) => state.addItem);
  const modalRef = useFocusTrap<HTMLDivElement>();

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const syntheticId =
    displayName.trim() && publisher.trim()
      ? buildCustomWingetId(publisher, displayName)
      : null;

  const clearError = (field: string) => {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleInstallerTypeChange = (type: CustomInstallerType) => {
    setInstallerType(type);
    // Pre-fill silent switches with the per-type default (same defaults the catalog uses)
    setSilentSwitches(CUSTOM_SILENT_SWITCH_DEFAULTS[type]);
  };

  const validate = (): Record<string, string> => {
    const nextErrors: Record<string, string> = {};
    if (!displayName.trim()) nextErrors.displayName = 'Display name is required';
    if (!publisher.trim()) nextErrors.publisher = 'Publisher is required';
    if (!version.trim()) nextErrors.version = 'Version is required';
    if (!installerUrl.trim()) {
      nextErrors.installerUrl = 'Installer URL is required';
    } else if (!isValidInstallerUrl(installerUrl.trim())) {
      nextErrors.installerUrl = 'Must be a valid http:// or https:// URL';
    }
    if (sha256.trim() && !isValidSha256(sha256.trim())) {
      nextErrors.sha256 = 'Must be a 64-character hexadecimal string';
    }
    if (iconUrl.trim() && !isValidIconUrl(iconUrl.trim())) {
      nextErrors.iconUrl = 'Must be a valid https:// URL';
    }
    return nextErrors;
  };

  const resetForm = () => {
    setDisplayName('');
    setPublisher('');
    setVersion('');
    setInstallerUrl('');
    setInstallerType('exe');
    setArchitecture('x64');
    setInstallScope('machine');
    setSilentSwitches(CUSTOM_SILENT_SWITCH_DEFAULTS.exe);
    setSha256('');
    setUninstallCommand('');
    setDescription('');
    setIconUrl('');
    setErrors({});
  };

  const handleAddToCart = () => {
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setIsAdding(true);
    try {
      const item = buildCustomAppCartItem({
        displayName,
        publisher,
        version,
        installerUrl,
        installerType,
        architecture,
        installScope,
        silentSwitches,
        sha256,
        uninstallCommand,
        description,
        iconUrl,
      });

      addItem(item);
      toast.success(`${item.displayName} added`, {
        description: `v${item.version} -- ${item.architecture}`,
      });
      resetForm();
      onClose();
    } catch (error) {
      toast.error('Failed to add custom app', {
        description: error instanceof Error ? error.message : 'Invalid input',
      });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="custom-app-title">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Modal */}
      <div ref={modalRef} className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-bg-surface border-l border-overlay/10 shadow-2xl overflow-hidden flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex-shrink-0 bg-bg-surface/95 backdrop-blur-sm border-b border-overlay/10 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-bg-elevated to-bg-surface flex items-center justify-center flex-shrink-0 border border-accent-cyan/30">
                <FilePlus2 className="w-6 h-6 text-accent-cyan" />
              </div>
              <div>
                <h2 id="custom-app-title" className="text-xl font-bold text-text-primary">Add Custom App</h2>
                <p className="text-text-muted text-sm">Deploy an app from a direct installer URL</p>
                {syntheticId && (
                  <p className="text-text-muted text-xs font-mono mt-1">{syntheticId}</p>
                )}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close custom app form" className="text-text-muted hover:text-text-primary transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Name & Publisher */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="custom-app-name" className="block text-sm font-medium text-text-muted mb-2">Display name</label>
                <Input
                  id="custom-app-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    clearError('displayName');
                  }}
                  placeholder="My App"
                  className={inputClassName}
                />
                {errors.displayName && (
                  <p className="text-xs text-status-error mt-1">{errors.displayName}</p>
                )}
              </div>
              <div>
                <label htmlFor="custom-app-publisher" className="block text-sm font-medium text-text-muted mb-2">Publisher</label>
                <Input
                  id="custom-app-publisher"
                  type="text"
                  value={publisher}
                  onChange={(e) => {
                    setPublisher(e.target.value);
                    clearError('publisher');
                  }}
                  placeholder="Contoso Ltd"
                  className={inputClassName}
                />
                {errors.publisher && (
                  <p className="text-xs text-status-error mt-1">{errors.publisher}</p>
                )}
              </div>
            </div>

            {/* Version */}
            <div>
              <label htmlFor="custom-app-version" className="block text-sm font-medium text-text-muted mb-2">Version</label>
              <Input
                id="custom-app-version"
                type="text"
                value={version}
                onChange={(e) => {
                  setVersion(e.target.value);
                  clearError('version');
                }}
                placeholder="1.0.0"
                className={inputClassName}
              />
              {errors.version && (
                <p className="text-xs text-status-error mt-1">{errors.version}</p>
              )}
            </div>

            {/* Installer URL */}
            <div>
              <label htmlFor="custom-app-installer-url" className="block text-sm font-medium text-text-muted mb-2">Installer URL</label>
              <Input
                id="custom-app-installer-url"
                type="url"
                value={installerUrl}
                onChange={(e) => {
                  setInstallerUrl(e.target.value);
                  clearError('installerUrl');
                }}
                placeholder="https://example.com/downloads/setup.exe"
                className={cn(inputClassName, 'font-mono')}
              />
              {errors.installerUrl && (
                <p className="text-xs text-status-error mt-1">{errors.installerUrl}</p>
              )}
            </div>

            {/* SHA256 */}
            <div>
              <label htmlFor="custom-app-sha256" className="block text-sm font-medium text-text-muted mb-2">SHA256 hash (optional)</label>
              <Input
                id="custom-app-sha256"
                type="text"
                value={sha256}
                onChange={(e) => {
                  setSha256(e.target.value);
                  clearError('sha256');
                }}
                placeholder="Calculated automatically when empty"
                className={cn(inputClassName, 'font-mono')}
              />
              <p className="text-xs text-text-muted mt-1">
                Provide a trusted hash for strict verification. When empty, the packaging runner
                calculates SHA256 from the downloaded installer and records it on the job.
              </p>
              {errors.sha256 && (
                <p className="text-xs text-status-error mt-1">{errors.sha256}</p>
              )}
            </div>

            {/* Installer Type */}
            <div>
              <label htmlFor="custom-app-installer-type" className="block text-sm font-medium text-text-muted mb-2">Installer type</label>
              <select
                id="custom-app-installer-type"
                value={installerType}
                onChange={(e) => handleInstallerTypeChange(e.target.value as CustomInstallerType)}
                className={inputClassName}
              >
                {INSTALLER_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Architecture */}
            <div>
              <label className="block text-sm font-medium text-text-muted mb-2">Architecture</label>
              <div className="flex flex-wrap gap-2">
                {(['x64', 'x86', 'arm64'] as WingetArchitecture[]).map((arch) => (
                  <button
                    key={arch}
                    type="button"
                    onClick={() => setArchitecture(arch)}
                    className={cn(
                      'flex-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors',
                      architecture === arch
                        ? 'bg-accent-cyan border-accent-cyan text-white'
                        : 'bg-bg-elevated border-overlay/15 text-text-primary hover:border-overlay/20'
                    )}
                  >
                    {arch}
                  </button>
                ))}
              </div>
            </div>

            {/* Install Scope */}
            <div>
              <label className="block text-sm font-medium text-text-muted mb-2">Install Scope</label>
              <div className="flex gap-2">
                {(['machine', 'user'] as WingetScope[]).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => setInstallScope(scope)}
                    className={cn(
                      'flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors',
                      installScope === scope
                        ? 'bg-accent-cyan border-accent-cyan text-white'
                        : 'bg-bg-elevated border-overlay/15 text-text-primary hover:border-overlay/20'
                    )}
                  >
                    {scope === 'machine' ? 'Per-Machine' : 'Per-User'}
                  </button>
                ))}
              </div>
            </div>

            {/* Optional fields */}
            <div className="border-t border-overlay/10 pt-6 space-y-6">
              <h3 className="text-sm font-semibold text-text-primary">Optional</h3>

              {/* Silent Switches */}
              <div>
                <label htmlFor="custom-app-silent-switches" className="block text-sm font-medium text-text-muted mb-2">Silent switches</label>
                <Input
                  id="custom-app-silent-switches"
                  type="text"
                  value={silentSwitches}
                  onChange={(e) => setSilentSwitches(e.target.value)}
                  placeholder={CUSTOM_SILENT_SWITCH_DEFAULTS[installerType]}
                  className={cn(inputClassName, 'font-mono')}
                />
                <p className="text-xs text-text-muted mt-1">
                  Pre-filled with the default for the selected installer type.
                </p>
              </div>

              {/* Uninstall Command */}
              <div>
                <label htmlFor="custom-app-uninstall" className="block text-sm font-medium text-text-muted mb-2">Uninstall command</label>
                <Input
                  id="custom-app-uninstall"
                  type="text"
                  value={uninstallCommand}
                  onChange={(e) => setUninstallCommand(e.target.value)}
                  placeholder="Auto-generated when empty"
                  className={cn(inputClassName, 'font-mono')}
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="custom-app-description" className="block text-sm font-medium text-text-muted mb-2">Description</label>
                <textarea
                  id="custom-app-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Shown in Intune and the Company Portal"
                  rows={3}
                  className={cn(inputClassName, 'resize-none')}
                />
              </div>

              {/* Icon URL */}
              <div>
                <label htmlFor="custom-app-icon-url" className="block text-sm font-medium text-text-muted mb-2">Icon URL</label>
                <Input
                  id="custom-app-icon-url"
                  type="url"
                  value={iconUrl}
                  onChange={(e) => {
                    setIconUrl(e.target.value);
                    clearError('iconUrl');
                  }}
                  placeholder="https://example.com/icon.png"
                  className={cn(inputClassName, 'font-mono')}
                />
                {errors.iconUrl && (
                  <p className="text-xs text-status-error mt-1">{errors.iconUrl}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-overlay/10 p-4 bg-bg-surface/95">
          <div className="flex gap-3">
            <Button
              onClick={onClose}
              variant="outline"
              className="flex-1 py-5 text-base font-medium border-overlay/15 text-text-primary hover:bg-overlay/10"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddToCart}
              disabled={isAdding}
              className="flex-1 py-5 text-base font-medium bg-accent-cyan hover:bg-accent-cyan-dim text-white"
            >
              {isAdding ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="w-5 h-5 mr-2" />
                  Add to Cart
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
