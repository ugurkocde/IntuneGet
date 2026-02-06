'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Package,
  ExternalLink,
  Download,
  Cpu,
  HardDrive,
  FileCode,
  Plus,
  Check,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { NormalizedPackage, NormalizedInstaller, WingetScope, WingetArchitecture } from '@/types/winget';
import type { DetectionRule } from '@/types/intune';
import { useCartStore } from '@/stores/cart-store';
import {
  generateDetectionRules,
  generateInstallCommand,
  generateUninstallCommand,
} from '@/lib/detection-rules';
import { cn } from '@/lib/utils';
import { DEFAULT_PSADT_CONFIG, getDefaultProcessesToClose } from '@/types/psadt';

interface PackageDetailsProps {
  package: NormalizedPackage;
  onClose: () => void;
}

export function PackageDetails({ package: pkg, onClose }: PackageDetailsProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [installers, setInstallers] = useState<NormalizedInstaller[]>([]);
  const [versions, setVersions] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState(pkg.version);
  const [selectedArch, setSelectedArch] = useState<WingetArchitecture>('x64');
  const [selectedScope, setSelectedScope] = useState<WingetScope>('machine');
  const [showVersions, setShowVersions] = useState(false);
  const [detectionRules, setDetectionRules] = useState<DetectionRule[]>([]);

  const addItem = useCartStore((state) => state.addItem);
  const isInCart = useCartStore((state) => state.isInCart);

  const selectedInstaller = installers.find(
    (i) => i.architecture === selectedArch
  ) || installers[0];

  const inCart = selectedInstaller
    ? isInCart(pkg.id, selectedVersion, selectedInstaller.architecture)
    : false;

  useEffect(() => {
    async function loadDetails() {
      setIsLoading(true);
      try {
        // Fetch package with installers
        const [pkgResponse, manifestResponse] = await Promise.all([
          fetch(`/api/winget/package?id=${encodeURIComponent(pkg.id)}`),
          fetch(
            `/api/winget/manifest?id=${encodeURIComponent(pkg.id)}&version=${selectedVersion}`
          ),
        ]);

        if (pkgResponse.ok) {
          const pkgData = await pkgResponse.json();
          setVersions(pkgData.versions || [pkg.version]);
        }

        if (manifestResponse.ok) {
          const manifestData = await manifestResponse.json();
          setInstallers(manifestData.installers || []);

          // Generate detection rules for the recommended installer
          // Pass wingetId and version for registry marker detection (most reliable for EXE installers)
          if (manifestData.recommendedInstaller) {
            setDetectionRules(
              generateDetectionRules(manifestData.recommendedInstaller, pkg.name, pkg.id, selectedVersion)
            );
          }
        }
      } catch (error) {
        console.error('Error loading package details:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadDetails();
  }, [pkg.id, pkg.name, selectedVersion]);

  useEffect(() => {
    // Update detection rules when installer changes
    // Pass wingetId and version for registry marker detection (most reliable for EXE installers)
    if (selectedInstaller) {
      setDetectionRules(generateDetectionRules(selectedInstaller, pkg.name, pkg.id, selectedVersion));
    }
  }, [selectedInstaller, pkg.name, pkg.id, selectedVersion]);

  const handleAddToCart = () => {
    if (!selectedInstaller || inCart) return;

    const processesToClose = getDefaultProcessesToClose(pkg.name, selectedInstaller.type);

    addItem({
      wingetId: pkg.id,
      displayName: pkg.name,
      publisher: pkg.publisher,
      version: selectedVersion,
      architecture: selectedInstaller.architecture,
      installScope: selectedScope,
      installerType: selectedInstaller.type,
      installerUrl: selectedInstaller.url,
      installerSha256: selectedInstaller.sha256,
      installCommand: generateInstallCommand(selectedInstaller, selectedScope),
      uninstallCommand: generateUninstallCommand(selectedInstaller, pkg.name),
      detectionRules,
      psadtConfig: {
        ...DEFAULT_PSADT_CONFIG,
        processesToClose,
        detectionRules,
      },
    });

    onClose();
  };

  const availableArchitectures = [...new Set(installers.map((i) => i.architecture))];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-slate-900 border-l border-slate-800 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-xl bg-slate-800 flex items-center justify-center flex-shrink-0">
                <Package className="w-7 h-7 text-slate-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{pkg.name}</h2>
                <p className="text-slate-400">{pkg.publisher}</p>
                <p className="text-slate-600 text-sm font-mono mt-1">{pkg.id}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Description */}
            {pkg.description && (
              <div>
                <h3 className="text-sm font-medium text-slate-400 mb-2">
                  Description
                </h3>
                <p className="text-white">{pkg.description}</p>
              </div>
            )}

            {/* Links */}
            <div className="flex gap-3">
              {pkg.homepage && (
                <a
                  href={pkg.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-blue-500 hover:text-blue-400 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Homepage
                </a>
              )}
              {pkg.license && (
                <span className="flex items-center gap-2 text-sm text-slate-400">
                  <FileCode className="w-4 h-4" />
                  {pkg.license}
                </span>
              )}
            </div>

            {/* Configuration */}
            <div className="border-t border-slate-800 pt-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                Configuration
              </h3>

              <div className="space-y-4">
                {/* Version selector */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Version
                  </label>
                  <div className="relative">
                    <button
                      onClick={() => setShowVersions(!showVersions)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white hover:border-slate-600 transition-colors"
                    >
                      <span>{selectedVersion}</span>
                      <ChevronDown
                        className={cn(
                          'w-4 h-4 transition-transform',
                          showVersions && 'rotate-180'
                        )}
                      />
                    </button>
                    {showVersions && (
                      <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                        {versions.map((version) => (
                          <button
                            key={version}
                            onClick={() => {
                              setSelectedVersion(version);
                              setShowVersions(false);
                            }}
                            className={cn(
                              'w-full px-4 py-2 text-left hover:bg-slate-700 transition-colors',
                              version === selectedVersion
                                ? 'text-blue-500 bg-blue-500/10'
                                : 'text-white'
                            )}
                          >
                            {version}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Architecture selector */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    <Cpu className="w-4 h-4 inline mr-1" />
                    Architecture
                  </label>
                  <div className="flex gap-2">
                    {(['x64', 'x86', 'arm64'] as WingetArchitecture[]).map((arch) => {
                      const available = availableArchitectures.includes(arch);
                      return (
                        <button
                          key={arch}
                          onClick={() => available && setSelectedArch(arch)}
                          disabled={!available}
                          className={cn(
                            'flex-1 px-4 py-2 rounded-lg border transition-colors',
                            selectedArch === arch
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : available
                              ? 'bg-slate-800 border-slate-700 text-white hover:border-slate-600'
                              : 'bg-slate-800/50 border-slate-700/50 text-slate-600 cursor-not-allowed'
                          )}
                        >
                          {arch}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Install scope selector */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    <HardDrive className="w-4 h-4 inline mr-1" />
                    Install Scope
                  </label>
                  <div className="flex gap-2">
                    {(['machine', 'user'] as WingetScope[]).map((scope) => (
                      <button
                        key={scope}
                        onClick={() => setSelectedScope(scope)}
                        className={cn(
                          'flex-1 px-4 py-2 rounded-lg border transition-colors',
                          selectedScope === scope
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-slate-800 border-slate-700 text-white hover:border-slate-600'
                        )}
                      >
                        {scope === 'machine' ? 'Per-Machine' : 'Per-User'}
                      </button>
                    ))}
                  </div>
                  <p className="text-slate-500 text-sm mt-2">
                    {selectedScope === 'machine'
                      ? 'Installs for all users on the device (recommended for enterprise)'
                      : 'Installs only for the current user'}
                  </p>
                </div>
              </div>
            </div>

            {/* Installer details */}
            {selectedInstaller && (
              <div className="border-t border-slate-800 pt-6">
                <h3 className="text-lg font-semibold text-white mb-4">
                  Installer Details
                </h3>

                <div className="bg-slate-800/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Type</span>
                    <span className="text-white font-mono text-sm uppercase">
                      {selectedInstaller.type}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">SHA256</span>
                    <span className="text-white font-mono text-xs truncate max-w-[200px]">
                      {selectedInstaller.sha256}
                    </span>
                  </div>
                  {selectedInstaller.silentArgs && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">Silent Args</span>
                      <span className="text-white font-mono text-sm">
                        {selectedInstaller.silentArgs}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Detection rules preview */}
            <div className="border-t border-slate-800 pt-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                Detection Rules
              </h3>

              <div className="space-y-3">
                {detectionRules.map((rule, index) => (
                  <div
                    key={index}
                    className="bg-slate-800/50 rounded-lg p-4"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 bg-blue-500/10 text-blue-500 text-xs font-medium rounded uppercase">
                        {rule.type}
                      </span>
                    </div>
                    <pre className="text-slate-400 text-sm font-mono whitespace-pre-wrap break-all">
                      {JSON.stringify(rule, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>

            {/* Add to cart button */}
            <div className="sticky bottom-0 bg-slate-900 border-t border-slate-800 -mx-6 px-6 py-4 mt-6">
              <Button
                onClick={handleAddToCart}
                disabled={!selectedInstaller || inCart}
                className={cn(
                  'w-full py-6 text-lg',
                  inCart
                    ? 'bg-green-600/10 text-green-500 hover:bg-green-600/10 cursor-default'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                )}
              >
                {inCart ? (
                  <>
                    <Check className="w-5 h-5 mr-2" />
                    Added to Cart
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
        )}
      </div>
    </div>
  );
}
