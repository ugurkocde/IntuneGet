'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Terminal,
  FileCode,
  ChevronDown,
  ChevronRight,
  Check,
  Loader2,
  Plus,
  Trash2,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AppIcon } from '@/components/AppIcon';
import { AssignmentConfig } from '@/components/AssignmentConfig';
import type { NormalizedPackage, NormalizedInstaller, WingetScope, WingetArchitecture } from '@/types/winget';
import type { PSADTConfig, ProcessToClose, DetectionRule } from '@/types/psadt';
import type { PackageAssignment } from '@/types/upload';
import { DEFAULT_PSADT_CONFIG, getDefaultProcessesToClose } from '@/types/psadt';
import { useCartStore } from '@/stores/cart-store';
import { generateDetectionRules, generateInstallCommand, generateUninstallCommand } from '@/lib/detection-rules';

interface PackageConfigProps {
  package: NormalizedPackage;
  installers: NormalizedInstaller[];
  onClose: () => void;
}

type ConfigSection = 'behavior' | 'detection' | 'assignment' | 'advanced';

export function PackageConfig({ package: pkg, installers, onClose }: PackageConfigProps) {
  // Selection state
  const [selectedVersion, setSelectedVersion] = useState(pkg.version);
  const [selectedArch, setSelectedArch] = useState<WingetArchitecture>('x64');
  const [selectedScope, setSelectedScope] = useState<WingetScope>('machine');
  const [showVersions, setShowVersions] = useState(false);

  // PSADT config state
  const [config, setConfig] = useState<PSADTConfig>(() => ({
    ...DEFAULT_PSADT_CONFIG,
    processesToClose: getDefaultProcessesToClose(pkg.name, installers[0]?.type || 'exe'),
  }));

  // Assignment configuration state
  const [assignments, setAssignments] = useState<PackageAssignment[]>([]);

  // UI state
  const [expandedSection, setExpandedSection] = useState<ConfigSection | null>('behavior');
  const [isAddingToCart, setIsAddingToCart] = useState(false);

  // Cart store
  const addItem = useCartStore((state) => state.addItem);
  const isInCart = useCartStore((state) => state.isInCart);

  // Get selected installer
  const selectedInstaller = installers.find((i) => i.architecture === selectedArch) || installers[0];
  const availableArchitectures = [...new Set(installers.map((i) => i.architecture))];
  const inCart = selectedInstaller
    ? isInCart(pkg.id, selectedVersion, selectedInstaller.architecture)
    : false;

  // Auto-select scope based on manifest's Scope field when installer changes
  useEffect(() => {
    if (selectedInstaller?.scope) {
      setSelectedScope(selectedInstaller.scope as WingetScope);
    }
  }, [selectedInstaller]);

  // Generate detection rules when installer or version changes
  // Pass wingetId and version for registry marker detection (most reliable for EXE installers)
  useEffect(() => {
    if (selectedInstaller) {
      const rules = generateDetectionRules(selectedInstaller, pkg.name, pkg.id, selectedVersion);
      setConfig((prev) => ({
        ...prev,
        detectionRules: rules as unknown as DetectionRule[],
      }));
    }
  }, [selectedInstaller, pkg.name, pkg.id, selectedVersion]);

  const handleAddToCart = async () => {
    if (!selectedInstaller || inCart) return;

    setIsAddingToCart(true);
    try {
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
        installCommand: config.installCommand || generateInstallCommand(selectedInstaller, selectedScope),
        uninstallCommand: config.uninstallCommand || generateUninstallCommand(selectedInstaller, pkg.name),
        detectionRules: config.detectionRules as any,
        psadtConfig: config,
        assignments: assignments.length > 0 ? assignments : undefined,
      });
      onClose();
    } finally {
      setIsAddingToCart(false);
    }
  };

  const updateConfig = (updates: Partial<PSADTConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  };

  const addProcess = () => {
    setConfig((prev) => ({
      ...prev,
      processesToClose: [
        ...prev.processesToClose,
        { name: '', description: '' },
      ],
    }));
  };

  const removeProcess = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      processesToClose: prev.processesToClose.filter((_, i) => i !== index),
    }));
  };

  const updateProcess = (index: number, updates: Partial<ProcessToClose>) => {
    setConfig((prev) => ({
      ...prev,
      processesToClose: prev.processesToClose.map((p, i) =>
        i === index ? { ...p, ...updates } : p
      ),
    }));
  };

  const toggleSection = (section: ConfigSection) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-slate-900 border-l border-slate-800 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <AppIcon
                packageId={pkg.id}
                packageName={pkg.name}
                iconPath={pkg.iconPath}
                size="lg"
                className="border-blue-500/30"
              />
              <div>
                <h2 className="text-xl font-bold text-white">{pkg.name}</h2>
                <p className="text-slate-400 text-sm">{pkg.publisher}</p>
                <p className="text-slate-600 text-xs font-mono mt-1">{pkg.id}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Version & Architecture Selection */}
            <div className="grid grid-cols-2 gap-4">
              {/* Version */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Version</label>
                <div className="relative">
                  <button
                    onClick={() => setShowVersions(!showVersions)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white hover:border-slate-600 transition-colors text-sm"
                  >
                    <span>v{selectedVersion}</span>
                    <ChevronDown className={cn('w-4 h-4 transition-transform', showVersions && 'rotate-180')} />
                  </button>
                  {showVersions && pkg.versions && (
                    <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                      {pkg.versions.slice(0, 10).map((version) => (
                        <button
                          key={version}
                          onClick={() => {
                            setSelectedVersion(version);
                            setShowVersions(false);
                          }}
                          className={cn(
                            'w-full px-4 py-2 text-left text-sm hover:bg-slate-700 transition-colors',
                            version === selectedVersion ? 'text-blue-400 bg-blue-500/10' : 'text-white'
                          )}
                        >
                          v{version}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Architecture */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Architecture</label>
                <div className="flex gap-2">
                  {(['x64', 'x86', 'arm64'] as WingetArchitecture[]).map((arch) => {
                    const available = availableArchitectures.includes(arch);
                    return (
                      <button
                        key={arch}
                        onClick={() => available && setSelectedArch(arch)}
                        disabled={!available}
                        className={cn(
                          'flex-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors',
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
            </div>

            {/* Install Scope */}
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Install Scope</label>
              <div className="flex gap-2">
                {(['machine', 'user'] as WingetScope[]).map((scope) => {
                  // Show "(Recommended)" based on manifest scope, or default to machine if not specified
                  const manifestScope = selectedInstaller?.scope;
                  const isRecommended = manifestScope ? scope === manifestScope : scope === 'machine';
                  const label = scope === 'machine' ? 'Per-Machine' : 'Per-User';

                  return (
                    <button
                      key={scope}
                      onClick={() => setSelectedScope(scope)}
                      className={cn(
                        'flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors',
                        selectedScope === scope
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-white hover:border-slate-600'
                      )}
                    >
                      {isRecommended ? `${label} (Recommended)` : label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-slate-800 pt-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-400" />
                Deployment Configuration
              </h3>

              {/* Installation Behavior */}
              <ConfigSection
                title="Installation Behavior"
                icon={<Settings className="w-4 h-4" />}
                expanded={expandedSection === 'behavior'}
                onToggle={() => toggleSection('behavior')}
              >
                <div className="space-y-4">
                  {/* Processes to Close */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-slate-300">
                        Processes to close before install
                      </label>
                      <button
                        onClick={addProcess}
                        className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
                      >
                        <Plus className="w-4 h-4" />
                        Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {config.processesToClose.length === 0 ? (
                        <p className="text-slate-500 text-sm italic">No processes configured</p>
                      ) : (
                        config.processesToClose.map((process, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={process.name}
                              onChange={(e) => updateProcess(index, { name: e.target.value })}
                              placeholder="Process name (e.g., chrome)"
                              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                            />
                            <input
                              type="text"
                              value={process.description}
                              onChange={(e) => updateProcess(index, { description: e.target.value })}
                              placeholder="Display name"
                              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                            />
                            <button
                              onClick={() => removeProcess(index)}
                              className="text-slate-500 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Show Close Prompt Toggle */}
                  <div className="space-y-3">
                    <ToggleOption
                      label="Show close prompt to users"
                      description="When enabled, users see a countdown dialog if the app is running"
                      checked={config.showClosePrompt || false}
                      onChange={(checked) => updateConfig({ showClosePrompt: checked })}
                    />

                    {/* Countdown Duration - only show when close prompt is enabled */}
                    {config.showClosePrompt && (
                      <div className="ml-6 border-l-2 border-slate-700 pl-4">
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          Countdown duration (seconds)
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min="10"
                            max="300"
                            step="10"
                            value={config.closeCountdown || 60}
                            onChange={(e) => updateConfig({ closeCountdown: parseInt(e.target.value) })}
                            className="flex-1"
                          />
                          <span className="text-white text-sm font-mono w-12 text-right">
                            {config.closeCountdown || 60}s
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Allow Deferral Toggle */}
                    <ToggleOption
                      label="Allow users to defer the update"
                      description="Let users postpone the installation"
                      checked={config.allowDefer}
                      onChange={(checked) => updateConfig({ allowDefer: checked })}
                    />

                    {/* Number of Deferrals - only show when deferral is enabled */}
                    {config.allowDefer && (
                      <div className="ml-6 border-l-2 border-slate-700 pl-4">
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          Maximum deferrals allowed
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={config.deferTimes || 3}
                          onChange={(e) => updateConfig({ deferTimes: parseInt(e.target.value) || 3 })}
                          className="w-20 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                        />
                      </div>
                    )}
                  </div>

                  {/* Restart Behavior */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Restart behavior
                    </label>
                    <select
                      value={config.restartBehavior}
                      onChange={(e) => updateConfig({ restartBehavior: e.target.value as any })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                    >
                      <option value="Suppress">Suppress restart (recommended)</option>
                      <option value="Prompt">Prompt user to restart</option>
                      <option value="Force">Force restart</option>
                    </select>
                  </div>
                </div>
              </ConfigSection>

              {/* Detection Rules */}
              <ConfigSection
                title="Detection Rules"
                icon={<FileCode className="w-4 h-4" />}
                expanded={expandedSection === 'detection'}
                onToggle={() => toggleSection('detection')}
              >
                <div className="space-y-3">
                  {config.detectionRules.length === 0 ? (
                    <p className="text-slate-500 text-sm italic">No detection rules configured</p>
                  ) : (
                    config.detectionRules.map((rule, index) => (
                      <div key={index} className="bg-slate-800/50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs font-medium rounded uppercase">
                            {rule.type}
                          </span>
                        </div>
                        <pre className="text-slate-400 text-xs font-mono whitespace-pre-wrap break-all">
                          {JSON.stringify(rule, null, 2)}
                        </pre>
                      </div>
                    ))
                  )}
                  <p className="text-slate-500 text-xs">
                    Detection rules are auto-generated based on installer type. They determine how Intune verifies the app is installed.
                  </p>
                </div>
              </ConfigSection>

              {/* Assignment Configuration */}
              <ConfigSection
                title="Assignment Configuration"
                icon={<Target className="w-4 h-4" />}
                expanded={expandedSection === 'assignment'}
                onToggle={() => toggleSection('assignment')}
              >
                <AssignmentConfig
                  assignments={assignments}
                  onChange={setAssignments}
                />
              </ConfigSection>

              {/* Advanced */}
              <ConfigSection
                title="Advanced Options"
                icon={<Terminal className="w-4 h-4" />}
                expanded={expandedSection === 'advanced'}
                onToggle={() => toggleSection('advanced')}
              >
                <div className="space-y-4">
                  {/* Custom Install Command */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Install command override
                    </label>
                    <input
                      type="text"
                      value={config.installCommand || ''}
                      onChange={(e) => updateConfig({ installCommand: e.target.value || undefined })}
                      placeholder={selectedInstaller ? generateInstallCommand(selectedInstaller, selectedScope) : ''}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm font-mono"
                    />
                    <p className="text-slate-500 text-xs mt-1">Leave empty to use auto-generated command</p>
                  </div>

                  {/* Custom Uninstall Command */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Uninstall command override
                    </label>
                    <input
                      type="text"
                      value={config.uninstallCommand || ''}
                      onChange={(e) => updateConfig({ uninstallCommand: e.target.value || undefined })}
                      placeholder={selectedInstaller ? generateUninstallCommand(selectedInstaller, pkg.name) : ''}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm font-mono"
                    />
                  </div>
                </div>
              </ConfigSection>

            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-slate-800 p-4 bg-slate-900/95">
          <Button
            onClick={handleAddToCart}
            disabled={!selectedInstaller || inCart || isAddingToCart}
            className={cn(
              'w-full py-5 text-base font-medium',
              inCart
                ? 'bg-green-600/10 text-green-400 hover:bg-green-600/10 cursor-default'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            )}
          >
            {isAddingToCart ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Adding...
              </>
            ) : inCart ? (
              <>
                <Check className="w-5 h-5 mr-2" />
                Added
              </>
            ) : (
              <>
                <Plus className="w-5 h-5 mr-2" />
                Add to Selection
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Sub-components

interface ConfigSectionProps {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function ConfigSection({ title, icon, expanded, onToggle, children }: ConfigSectionProps) {
  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden mb-3">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/50 hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2 text-white">
          {icon}
          <span className="font-medium">{title}</span>
        </div>
        <ChevronRight className={cn('w-4 h-4 text-slate-400 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && <div className="p-4 bg-slate-900/50">{children}</div>}
    </div>
  );
}

interface ToggleOptionProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleOption({ label, description, checked, onChange }: ToggleOptionProps) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <div className="pt-0.5">
        <div
          className={cn(
            'w-10 h-6 rounded-full transition-colors relative',
            checked ? 'bg-blue-600' : 'bg-slate-700'
          )}
          onClick={() => onChange(!checked)}
        >
          <div
            className={cn(
              'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
              checked ? 'translate-x-5' : 'translate-x-1'
            )}
          />
        </div>
      </div>
      <div>
        <span className="text-white text-sm font-medium">{label}</span>
        <p className="text-slate-500 text-xs">{description}</p>
      </div>
    </label>
  );
}
