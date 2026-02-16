'use client';

import { useState, useEffect, useRef, useMemo, useId } from 'react';
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
  Bell,
  RefreshCw,
  HardDrive,
  MessageSquare,
  Clock,
  FolderTree,
  Palette,
  Zap,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AppIcon } from '@/components/AppIcon';
import { AssignmentConfig } from '@/components/AssignmentConfig';
import { CategoryConfig } from '@/components/CategoryConfig';
import type { NormalizedPackage, NormalizedInstaller, WingetScope, WingetArchitecture } from '@/types/winget';
import type {
  PSADTConfig,
  ProcessToClose,
  DetectionRule,
  RestartBehavior,
  DialogPosition,
  DialogIcon,
  BalloonIcon,
  CustomPrompt,
  BalloonTipConfig,
} from '@/types/psadt';
import type { CartItem, IntuneAppCategorySelection, PackageAssignment } from '@/types/upload';
import { DEFAULT_PSADT_CONFIG, getDefaultProcessesToClose } from '@/types/psadt';
import { useCartStore } from '@/stores/cart-store';
import { useUpdateAppSettings } from '@/hooks/use-update-app-settings';
import { generateDetectionRules, generateInstallCommand, generateUninstallCommand } from '@/lib/detection-rules';

interface PackageConfigProps {
  package: NormalizedPackage;
  installers: NormalizedInstaller[];
  onClose: () => void;
  isDeployed?: boolean;
  deployedConfig?: CartItem | null;
  intuneAppId?: string | null;
}

type ConfigSection =
  | 'behavior'
  | 'deferral'
  | 'progress'
  | 'prompts'
  | 'restart'
  | 'diskspace'
  | 'detection'
  | 'assignment'
  | 'category'
  | 'branding'
  | 'advanced';

export function PackageConfig({ package: pkg, installers, onClose, isDeployed = false, deployedConfig, intuneAppId }: PackageConfigProps) {
  // Selection state - pre-fill from deployed config when available
  const [selectedVersion, setSelectedVersion] = useState(
    deployedConfig?.version || pkg.version
  );
  const [selectedArch, setSelectedArch] = useState<WingetArchitecture>(() => {
    const preferred = deployedConfig?.architecture || 'x64';
    const available = new Set(installers.map((i) => i.architecture));
    return available.has(preferred) ? preferred : (installers[0]?.architecture || 'x64');
  });
  const [selectedScope, setSelectedScope] = useState<WingetScope>(
    deployedConfig?.installScope || 'machine'
  );
  const [showVersions, setShowVersions] = useState(false);

  // PSADT config state - pre-fill from deployed config when available
  const [config, setConfig] = useState<PSADTConfig>(() => {
    if (deployedConfig?.psadtConfig) {
      return deployedConfig.psadtConfig;
    }
    return {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: getDefaultProcessesToClose(pkg.name, installers[0]?.type || 'exe'),
    };
  });

  // Assignment configuration state - pre-fill from deployed config
  const [assignments, setAssignments] = useState<PackageAssignment[]>(
    deployedConfig?.assignments || []
  );
  const [categories, setCategories] = useState<IntuneAppCategorySelection[]>(
    deployedConfig?.categories || []
  );

  // UI state
  const [expandedSection, setExpandedSection] = useState<ConfigSection | null>('detection');
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [addedToCartSuccess, setAddedToCartSuccess] = useState(false);
  const [configMode, setConfigMode] = useState<'quick' | 'advanced'>('quick');

  const quickSections: ConfigSection[] = ['detection', 'assignment', 'category'];
  const isQuickSection = (section: ConfigSection) => quickSections.includes(section);
  const visibleSections = configMode === 'quick' ? quickSections : null; // null = show all

  // Cart store
  const addItem = useCartStore((state) => state.addItem);
  const isInCart = useCartStore((state) => state.isInCart);

  // Settings update mutation (for deployed apps with known Intune app ID)
  const { updateSettings, isUpdating } = useUpdateAppSettings();
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const canUpdateSettings = isDeployed && !!intuneAppId;

  // Change detection: categorize modifications as Graph-patchable vs requires-redeploy
  const changeState = useMemo(() => {
    if (!isDeployed || !deployedConfig) {
      return { hasGraphChanges: false, hasRedeployChanges: false };
    }

    // Graph-patchable: assignments + categories
    const hasAssignmentChanges =
      JSON.stringify(assignments) !== JSON.stringify(deployedConfig.assignments || []);
    const hasCategoryChanges =
      JSON.stringify(categories) !== JSON.stringify(deployedConfig.categories || []);
    const hasGraphChanges = hasAssignmentChanges || hasCategoryChanges;

    // Redeploy-required: version, architecture, scope, PSADT config
    const hasVersionChange = selectedVersion !== deployedConfig.version;
    const hasArchChange = selectedArch !== deployedConfig.architecture;
    const hasScopeChange = selectedScope !== deployedConfig.installScope;
    const hasPsadtChange =
      JSON.stringify(config) !== JSON.stringify(deployedConfig.psadtConfig);
    const hasRedeployChanges =
      hasVersionChange || hasArchChange || hasScopeChange || hasPsadtChange;

    return { hasGraphChanges, hasRedeployChanges };
  }, [isDeployed, deployedConfig, assignments, categories,
      selectedVersion, selectedArch, selectedScope, config]);

  // Get selected installer
  const selectedInstaller = installers.find((i) => i.architecture === selectedArch) || installers[0];
  const availableArchitectures = [...new Set(installers.map((i) => i.architecture))];
  const inCart = selectedInstaller
    ? isInCart(pkg.id, selectedVersion, selectedInstaller.architecture)
    : false;

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Auto-select scope based on manifest's Scope field when installer changes
  // Skip the initial mount when pre-filled from deployed config (user's previous choice takes priority)
  const skipInitialScopeSync = useRef(!!deployedConfig);
  useEffect(() => {
    if (skipInitialScopeSync.current) {
      skipInitialScopeSync.current = false;
      return;
    }
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
        detectionRules: rules,
      }));
    }
  }, [selectedInstaller, pkg.name, pkg.id, selectedVersion]);

  const handleAddToCart = async () => {
    if (!selectedInstaller || inCart || addedToCartSuccess) return;

    setIsAddingToCart(true);
    try {
      addItem({
        wingetId: pkg.id,
        displayName: pkg.name,
        publisher: pkg.publisher,
        description: pkg.description,
        version: selectedVersion,
        architecture: selectedInstaller.architecture,
        installScope: selectedScope,
        installerType: selectedInstaller.type,
        installerUrl: selectedInstaller.url,
        installerSha256: selectedInstaller.sha256,
        installCommand: config.installCommand || generateInstallCommand(selectedInstaller, selectedScope),
        uninstallCommand: config.uninstallCommand || generateUninstallCommand(selectedInstaller, pkg.name),
        detectionRules: config.detectionRules,
        psadtConfig: config,
        assignments: assignments.length > 0 ? assignments : undefined,
        categories: categories.length > 0 ? categories : undefined,
        ...(isDeployed ? { forceCreate: true } : {}),
      });
      setAddedToCartSuccess(true);
      setTimeout(() => onClose(), 1200);
    } finally {
      setIsAddingToCart(false);
    }
  };

  const handleUpdateSettings = async () => {
    if (!intuneAppId) return;
    setSettingsError(null);
    setSettingsSuccess(false);
    try {
      await updateSettings({
        intuneAppId,
        wingetId: pkg.id,
        assignments,
        categories,
      });
      setSettingsSuccess(true);
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to update settings');
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
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="package-config-title">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Modal */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-bg-surface border-l border-overlay/10 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 bg-bg-surface/95 backdrop-blur-sm border-b border-overlay/10 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <AppIcon
                packageId={pkg.id}
                packageName={pkg.name}
                iconPath={pkg.iconPath}
                size="lg"
                className="border-accent-cyan/30"
              />
              <div>
                <h2 id="package-config-title" className="text-xl font-bold text-text-primary">{pkg.name}</h2>
                <p className="text-text-muted text-sm">{pkg.publisher}</p>
                <p className="text-text-muted text-xs font-mono mt-1">{pkg.id}</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close configuration" className="text-text-muted hover:text-text-primary transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Edit mode banner for deployed apps */}
            {isDeployed && (
              <div className="flex items-start gap-3 p-3 bg-accent-cyan/10 border border-accent-cyan/20 rounded-lg">
                <RefreshCw className="w-5 h-5 text-accent-cyan flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-accent-cyan font-medium">Editing deployed configuration</p>
                  <p className="text-accent-cyan/70 mt-1">
                    {!canUpdateSettings
                      ? 'Changes will be applied as a new deployment.'
                      : !changeState.hasGraphChanges && !changeState.hasRedeployChanges
                      ? 'No changes detected. Previous settings have been pre-filled.'
                      : changeState.hasGraphChanges && !changeState.hasRedeployChanges
                      ? 'Assignment and category changes can be applied instantly with Update Settings.'
                      : !changeState.hasGraphChanges && changeState.hasRedeployChanges
                      ? 'Package configuration changes require a redeployment.'
                      : 'Assignment/category changes can be applied instantly. Package configuration changes also detected -- those require a separate redeployment.'}
                    {!canUpdateSettings && deployedConfig ? ' Previous settings have been pre-filled.' : !canUpdateSettings ? ' Using default settings (no previous config found).' : ''}
                  </p>
                </div>
              </div>
            )}

            {/* Version & Architecture Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Version */}
              <div>
                <label className="block text-sm font-medium text-text-muted mb-2">Version</label>
                <div className="relative">
                  <button
                    onClick={() => setShowVersions(!showVersions)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary hover:border-overlay/20 transition-colors text-sm"
                  >
                    <span>v{selectedVersion}</span>
                    <ChevronDown className={cn('w-4 h-4 transition-transform', showVersions && 'rotate-180')} />
                  </button>
                  {showVersions && pkg.versions && (
                    <div className="absolute z-10 w-full mt-1 bg-bg-elevated border border-overlay/15 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                      {pkg.versions.slice(0, 10).map((version) => (
                        <button
                          key={version}
                          onClick={() => {
                            setSelectedVersion(version);
                            setShowVersions(false);
                          }}
                          className={cn(
                            'w-full px-4 py-2 text-left text-sm hover:bg-overlay/15 transition-colors',
                            version === selectedVersion ? 'text-accent-cyan bg-accent-cyan/10' : 'text-text-primary'
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
                <label className="block text-sm font-medium text-text-muted mb-2">Architecture</label>
                <div className="flex flex-wrap gap-2">
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
                            ? 'bg-accent-cyan border-accent-cyan text-white'
                            : available
                            ? 'bg-bg-elevated border-overlay/15 text-text-primary hover:border-overlay/20'
                            : 'bg-bg-elevated/50 border-overlay/[0.07] text-text-muted cursor-not-allowed'
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
              <label className="block text-sm font-medium text-text-muted mb-2">Install Scope</label>
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
                          ? 'bg-accent-cyan border-accent-cyan text-white'
                          : 'bg-bg-elevated border-overlay/15 text-text-primary hover:border-overlay/20'
                      )}
                    >
                      {isRecommended ? `${label} (Recommended)` : label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-overlay/10 pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                  <Settings className="w-5 h-5 text-accent-cyan" />
                  Deployment Configuration
                </h3>
                <div className="inline-flex items-center rounded-lg border border-overlay/10 bg-bg-elevated p-0.5">
                  <button
                    onClick={() => setConfigMode('quick')}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5',
                      configMode === 'quick'
                        ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/25'
                        : 'text-text-secondary hover:text-text-primary'
                    )}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Quick
                  </button>
                  <button
                    onClick={() => setConfigMode('advanced')}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5',
                      configMode === 'advanced'
                        ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/25'
                        : 'text-text-secondary hover:text-text-primary'
                    )}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    Advanced
                  </button>
                </div>
              </div>

              {/* Installation Behavior (advanced only) */}
              {(visibleSections === null || visibleSections.includes('behavior')) && <ConfigSection
                title="Installation Behavior"
                icon={<Settings className="w-4 h-4" />}
                expanded={expandedSection === 'behavior'}
                onToggle={() => toggleSection('behavior')}
              >
                <div className="space-y-4">
                  {/* Processes to Close */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-text-secondary">
                        Processes to close before install
                      </label>
                      <button
                        onClick={addProcess}
                        className="text-accent-cyan hover:text-accent-cyan-dim text-sm flex items-center gap-1"
                      >
                        <Plus className="w-4 h-4" />
                        Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {config.processesToClose.length === 0 ? (
                        <p className="text-text-muted text-sm italic">No processes configured</p>
                      ) : (
                        config.processesToClose.map((process, index) => (
                          <div key={index} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <input
                              type="text"
                              value={process.name}
                              onChange={(e) => updateProcess(index, { name: e.target.value })}
                              placeholder="Process name (e.g., chrome)"
                              className="flex-1 px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                            />
                            <input
                              type="text"
                              value={process.description}
                              onChange={(e) => updateProcess(index, { description: e.target.value })}
                              placeholder="Display name"
                              className="flex-1 px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                            />
                            <button
                              onClick={() => removeProcess(index)}
                              className="text-text-muted hover:text-red-400 transition-colors"
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
                      <div className="ml-6 border-l-2 border-overlay/15 pl-4">
                        <label className="block text-sm font-medium text-text-secondary mb-2">
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
                          <span className="text-text-primary text-sm font-mono w-12 text-right">
                            {config.closeCountdown || 60}s
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Block Execution Toggle */}
                    <ToggleOption
                      label="Block execution during install"
                      description="Prevent users from launching the application during installation"
                      checked={config.blockExecution || false}
                      onChange={(checked) => updateConfig({ blockExecution: checked })}
                    />

                    {/* Prompt to Save Toggle */}
                    <ToggleOption
                      label="Prompt to save documents"
                      description="Ask users to save their work before closing applications"
                      checked={config.promptToSave || false}
                      onChange={(checked) => updateConfig({ promptToSave: checked })}
                    />

                    {/* Persist Prompt Toggle */}
                    <ToggleOption
                      label="Persist prompt until answered"
                      description="Make the dialog reappear if user closes it without responding"
                      checked={config.persistPrompt || false}
                      onChange={(checked) => updateConfig({ persistPrompt: checked })}
                    />

                    {/* Minimize Windows Toggle */}
                    <ToggleOption
                      label="Minimize other windows"
                      description="Minimize all other windows when showing the installation dialog"
                      checked={config.minimizeWindows || false}
                      onChange={(checked) => updateConfig({ minimizeWindows: checked })}
                    />
                  </div>

                  {/* Window Location */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Dialog position
                    </label>
                    <select
                      value={config.windowLocation || 'Default'}
                      onChange={(e) => updateConfig({ windowLocation: e.target.value as DialogPosition })}
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                    >
                      <option value="Default">Default</option>
                      <option value="Center">Center</option>
                      <option value="Top">Top</option>
                      <option value="Bottom">Bottom</option>
                      <option value="TopLeft">Top Left</option>
                      <option value="TopRight">Top Right</option>
                      <option value="BottomLeft">Bottom Left</option>
                      <option value="BottomRight">Bottom Right</option>
                    </select>
                  </div>

                  {/* Restart Behavior */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Restart behavior
                    </label>
                    <select
                      value={config.restartBehavior}
                      onChange={(e) => updateConfig({ restartBehavior: e.target.value as RestartBehavior })}
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                    >
                      <option value="Suppress">Suppress restart (recommended)</option>
                      <option value="Prompt">Prompt user to restart</option>
                      <option value="Force">Force restart</option>
                    </select>
                  </div>
                </div>
              </ConfigSection>}

              {/* Deferral Settings (advanced only) */}
              {(visibleSections === null || visibleSections.includes('deferral')) && <ConfigSection
                title="Deferral Settings"
                icon={<Clock className="w-4 h-4" />}
                expanded={expandedSection === 'deferral'}
                onToggle={() => toggleSection('deferral')}
              >
                <div className="space-y-4">
                  {/* Allow Deferral Toggle */}
                  <ToggleOption
                    label="Allow users to defer installation"
                    description="Let users postpone the installation to a later time"
                    checked={config.allowDefer}
                    onChange={(checked) => updateConfig({ allowDefer: checked })}
                  />

                  {config.allowDefer && (
                    <div className="ml-6 border-l-2 border-overlay/15 pl-4 space-y-4">
                      {/* Maximum Deferrals */}
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                          Maximum deferrals allowed
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="99"
                          value={config.deferTimes || 3}
                          onChange={(e) => updateConfig({ deferTimes: parseInt(e.target.value) || 3 })}
                          className="w-24 px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                        />
                      </div>

                      {/* Deferral Days */}
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                          Deferral days limit (optional)
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="365"
                          value={config.deferDays || ''}
                          onChange={(e) => updateConfig({ deferDays: e.target.value ? parseInt(e.target.value) : undefined })}
                          placeholder="No limit"
                          className="w-24 px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                        />
                        <p className="text-text-muted text-xs mt-1">Number of days user can defer from first prompt</p>
                      </div>

                      {/* Deferral Deadline */}
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                          Deferral deadline (optional)
                        </label>
                        <input
                          type="date"
                          value={config.deferDeadline || ''}
                          onChange={(e) => updateConfig({ deferDeadline: e.target.value || undefined })}
                          className="px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                        />
                        <p className="text-text-muted text-xs mt-1">After this date, users cannot defer</p>
                      </div>

                      {/* Force Close Countdown */}
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                          Force close countdown (optional)
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min="0"
                            max="3600"
                            value={config.forceCloseProcessesCountdown || ''}
                            onChange={(e) => updateConfig({ forceCloseProcessesCountdown: e.target.value ? parseInt(e.target.value) : undefined })}
                            placeholder="Not set"
                            className="w-24 px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                          />
                          <span className="text-text-muted text-sm">seconds</span>
                        </div>
                        <p className="text-text-muted text-xs mt-1">Forces countdown regardless of deferral settings</p>
                      </div>
                    </div>
                  )}
                </div>
              </ConfigSection>}

              {/* Progress & Notifications (advanced only) */}
              {(visibleSections === null || visibleSections.includes('progress')) && <ConfigSection
                title="Progress & Notifications"
                icon={<Bell className="w-4 h-4" />}
                expanded={expandedSection === 'progress'}
                onToggle={() => toggleSection('progress')}
              >
                <div className="space-y-4">
                  {/* Progress Dialog */}
                  <ToggleOption
                    label="Show progress dialog"
                    description="Display a progress window during installation"
                    checked={config.progressDialog?.enabled || false}
                    onChange={(checked) => updateConfig({
                      progressDialog: { ...config.progressDialog, enabled: checked }
                    })}
                  />

                  {config.progressDialog?.enabled && (
                    <div className="ml-6 border-l-2 border-overlay/15 pl-4 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                          Status message (optional)
                        </label>
                        <input
                          type="text"
                          value={config.progressDialog?.statusMessage || ''}
                          onChange={(e) => updateConfig({
                            progressDialog: { ...config.progressDialog, enabled: true, statusMessage: e.target.value || undefined }
                          })}
                          placeholder="Installing application..."
                          className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                          Window position
                        </label>
                        <select
                          value={config.progressDialog?.windowLocation || 'Default'}
                          onChange={(e) => updateConfig({
                            progressDialog: { ...config.progressDialog, enabled: true, windowLocation: e.target.value as DialogPosition }
                          })}
                          className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                        >
                          <option value="Default">Default</option>
                          <option value="Center">Center</option>
                          <option value="BottomRight">Bottom Right</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Balloon Tips Section */}
                  <div className="border-t border-overlay/15 pt-4 mt-4">
                    <div className="flex items-center justify-between mb-3">
                      <label className="block text-sm font-medium text-text-secondary">
                        Balloon notifications
                      </label>
                      <button
                        onClick={() => {
                          const newTip: BalloonTipConfig = {
                            enabled: true,
                            timing: 'start',
                            title: 'Installation',
                            text: 'Installation in progress...',
                            icon: 'Info',
                            displayTime: 10000,
                          };
                          updateConfig({
                            balloonTips: [...(config.balloonTips || []), newTip]
                          });
                        }}
                        className="text-accent-cyan hover:text-accent-cyan-dim text-sm flex items-center gap-1"
                      >
                        <Plus className="w-4 h-4" />
                        Add
                      </button>
                    </div>
                    {(!config.balloonTips || config.balloonTips.length === 0) ? (
                      <p className="text-text-muted text-sm italic">No balloon notifications configured</p>
                    ) : (
                      <div className="space-y-3">
                        {config.balloonTips.map((tip, index) => (
                          <div key={index} className="bg-bg-elevated/50 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-text-primary">Notification {index + 1}</span>
                              <button
                                onClick={() => {
                                  const newTips = config.balloonTips.filter((_, i) => i !== index);
                                  updateConfig({ balloonTips: newTips });
                                }}
                                className="text-text-muted hover:text-red-400 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <select
                                value={tip.timing}
                                onChange={(e) => {
                                  const newTips = [...config.balloonTips];
                                  newTips[index] = { ...tip, timing: e.target.value as 'start' | 'end' };
                                  updateConfig({ balloonTips: newTips });
                                }}
                                className="px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded text-text-primary text-sm"
                              >
                                <option value="start">At start</option>
                                <option value="end">At end</option>
                              </select>
                              <select
                                value={tip.icon}
                                onChange={(e) => {
                                  const newTips = [...config.balloonTips];
                                  newTips[index] = { ...tip, icon: e.target.value as BalloonIcon };
                                  updateConfig({ balloonTips: newTips });
                                }}
                                className="px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded text-text-primary text-sm"
                              >
                                <option value="Info">Info</option>
                                <option value="Warning">Warning</option>
                                <option value="Error">Error</option>
                                <option value="None">None</option>
                              </select>
                            </div>
                            <input
                              type="text"
                              value={tip.title}
                              onChange={(e) => {
                                const newTips = [...config.balloonTips];
                                newTips[index] = { ...tip, title: e.target.value };
                                updateConfig({ balloonTips: newTips });
                              }}
                              placeholder="Title"
                              className="w-full px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded text-text-primary text-sm"
                            />
                            <input
                              type="text"
                              value={tip.text}
                              onChange={(e) => {
                                const newTips = [...config.balloonTips];
                                newTips[index] = { ...tip, text: e.target.value };
                                updateConfig({ balloonTips: newTips });
                              }}
                              placeholder="Message text"
                              className="w-full px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded text-text-primary text-sm"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </ConfigSection>}

              {/* Custom Prompts (advanced only) */}
              {(visibleSections === null || visibleSections.includes('prompts')) && <ConfigSection
                title="Custom Prompts"
                icon={<MessageSquare className="w-4 h-4" />}
                expanded={expandedSection === 'prompts'}
                onToggle={() => toggleSection('prompts')}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-text-muted text-sm">Add custom dialog prompts at specific points during installation.</p>
                    <button
                      onClick={() => {
                        const newPrompt: CustomPrompt = {
                          enabled: true,
                          timing: 'pre-install',
                          title: 'Installation Notice',
                          message: 'Please read the following information before proceeding.',
                          icon: 'Information',
                          buttonRightText: 'Continue',
                          timeout: 0,
                          persistPrompt: false,
                        };
                        updateConfig({
                          customPrompts: [...(config.customPrompts || []), newPrompt]
                        });
                      }}
                      className="text-accent-cyan hover:text-accent-cyan-dim text-sm flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" />
                      Add Prompt
                    </button>
                  </div>

                  {(!config.customPrompts || config.customPrompts.length === 0) ? (
                    <p className="text-text-muted text-sm italic">No custom prompts configured</p>
                  ) : (
                    <div className="space-y-4">
                      {config.customPrompts.map((prompt, index) => (
                        <div key={index} className="bg-bg-elevated/50 rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-text-primary">Prompt {index + 1}</span>
                            <div className="flex items-center gap-2">
                              <ToggleOption
                                label=""
                                description=""
                                checked={prompt.enabled}
                                onChange={(checked) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, enabled: checked };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                              />
                              <button
                                onClick={() => {
                                  const newPrompts = config.customPrompts.filter((_, i) => i !== index);
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                className="text-text-muted hover:text-red-400 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-text-muted mb-1">Timing</label>
                              <select
                                value={prompt.timing}
                                onChange={(e) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, timing: e.target.value as CustomPrompt['timing'] };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                className="w-full px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded text-text-primary text-sm"
                              >
                                <option value="pre-install">Before Install</option>
                                <option value="post-install">After Install</option>
                                <option value="pre-uninstall">Before Uninstall</option>
                                <option value="post-uninstall">After Uninstall</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-text-muted mb-1">Icon</label>
                              <select
                                value={prompt.icon}
                                onChange={(e) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, icon: e.target.value as DialogIcon };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                className="w-full px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded text-text-primary text-sm"
                              >
                                <option value="None">None</option>
                                <option value="Information">Information</option>
                                <option value="Warning">Warning</option>
                                <option value="Error">Error</option>
                                <option value="Question">Question</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Title</label>
                            <input
                              type="text"
                              value={prompt.title}
                              onChange={(e) => {
                                const newPrompts = [...config.customPrompts];
                                newPrompts[index] = { ...prompt, title: e.target.value };
                                updateConfig({ customPrompts: newPrompts });
                              }}
                              placeholder="Dialog title"
                              className="w-full px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded text-text-primary text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Message</label>
                            <textarea
                              value={prompt.message}
                              onChange={(e) => {
                                const newPrompts = [...config.customPrompts];
                                newPrompts[index] = { ...prompt, message: e.target.value };
                                updateConfig({ customPrompts: newPrompts });
                              }}
                              placeholder="Dialog message"
                              rows={2}
                              className="w-full px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded text-text-primary text-sm resize-none"
                            />
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-xs text-text-muted mb-1">Left Button</label>
                              <input
                                type="text"
                                value={prompt.buttonLeftText || ''}
                                onChange={(e) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, buttonLeftText: e.target.value || undefined };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                placeholder="Optional"
                                className="w-full px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded text-text-primary text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-text-muted mb-1">Middle Button</label>
                              <input
                                type="text"
                                value={prompt.buttonMiddleText || ''}
                                onChange={(e) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, buttonMiddleText: e.target.value || undefined };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                placeholder="Optional"
                                className="w-full px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded text-text-primary text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-text-muted mb-1">Right Button</label>
                              <input
                                type="text"
                                value={prompt.buttonRightText || ''}
                                onChange={(e) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, buttonRightText: e.target.value || undefined };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                placeholder="Continue"
                                className="w-full px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded text-text-primary text-sm"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-text-muted mb-1">Timeout (seconds)</label>
                              <input
                                type="number"
                                min="0"
                                value={prompt.timeout || 0}
                                onChange={(e) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, timeout: parseInt(e.target.value) || 0 };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                className="w-full px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded text-text-primary text-sm"
                              />
                            </div>
                            <div className="flex items-end pb-1">
                              <ToggleOption
                                label="Persist"
                                description=""
                                checked={prompt.persistPrompt || false}
                                onChange={(checked) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, persistPrompt: checked };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </ConfigSection>}

              {/* Restart Prompt (advanced only) */}
              {(visibleSections === null || visibleSections.includes('restart')) && <ConfigSection
                title="Restart Prompt"
                icon={<RefreshCw className="w-4 h-4" />}
                expanded={expandedSection === 'restart'}
                onToggle={() => toggleSection('restart')}
              >
                <div className="space-y-4">
                  <ToggleOption
                    label="Show restart prompt after installation"
                    description="Display a countdown dialog prompting users to restart"
                    checked={config.restartPrompt?.enabled || false}
                    onChange={(checked) => updateConfig({
                      restartPrompt: { ...config.restartPrompt, enabled: checked, countdownSeconds: config.restartPrompt?.countdownSeconds || 600, countdownNoHideSeconds: config.restartPrompt?.countdownNoHideSeconds || 60 }
                    })}
                  />

                  {config.restartPrompt?.enabled && (
                    <div className="ml-6 border-l-2 border-overlay/15 pl-4 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                          Countdown duration (seconds)
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min="60"
                            max="3600"
                            step="60"
                            value={config.restartPrompt?.countdownSeconds || 600}
                            onChange={(e) => updateConfig({
                              restartPrompt: { ...config.restartPrompt, enabled: true, countdownSeconds: parseInt(e.target.value), countdownNoHideSeconds: config.restartPrompt?.countdownNoHideSeconds || 60 }
                            })}
                            className="flex-1"
                          />
                          <span className="text-text-primary text-sm font-mono w-16 text-right">
                            {config.restartPrompt?.countdownSeconds || 600}s
                          </span>
                        </div>
                        <p className="text-text-muted text-xs mt-1">Total time before automatic restart</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                          No-hide countdown (seconds)
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min="10"
                            max="300"
                            step="10"
                            value={config.restartPrompt?.countdownNoHideSeconds || 60}
                            onChange={(e) => updateConfig({
                              restartPrompt: { ...config.restartPrompt, enabled: true, countdownSeconds: config.restartPrompt?.countdownSeconds || 600, countdownNoHideSeconds: parseInt(e.target.value) }
                            })}
                            className="flex-1"
                          />
                          <span className="text-text-primary text-sm font-mono w-16 text-right">
                            {config.restartPrompt?.countdownNoHideSeconds || 60}s
                          </span>
                        </div>
                        <p className="text-text-muted text-xs mt-1">Time before restart when user cannot dismiss the dialog</p>
                      </div>
                    </div>
                  )}
                </div>
              </ConfigSection>}

              {/* Disk Space Check (advanced only) */}
              {(visibleSections === null || visibleSections.includes('diskspace')) && <ConfigSection
                title="Disk Space Check"
                icon={<HardDrive className="w-4 h-4" />}
                expanded={expandedSection === 'diskspace'}
                onToggle={() => toggleSection('diskspace')}
              >
                <div className="space-y-4">
                  <ToggleOption
                    label="Check disk space before installation"
                    description="Verify sufficient disk space is available before proceeding"
                    checked={config.checkDiskSpace || false}
                    onChange={(checked) => updateConfig({ checkDiskSpace: checked })}
                  />

                  {config.checkDiskSpace && (
                    <div className="ml-6 border-l-2 border-overlay/15 pl-4">
                      <label className="block text-sm font-medium text-text-secondary mb-2">
                        Required disk space (MB)
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min="1"
                          max="100000"
                          value={config.requiredDiskSpace || ''}
                          onChange={(e) => updateConfig({ requiredDiskSpace: e.target.value ? parseInt(e.target.value) : undefined })}
                          placeholder="Auto-detect"
                          className="w-32 px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                        />
                        <span className="text-text-muted text-sm">MB</span>
                      </div>
                      <p className="text-text-muted text-xs mt-1">Leave empty to auto-detect from installer size</p>
                    </div>
                  )}
                </div>
              </ConfigSection>}

              {/* Detection Rules (quick + advanced) */}
              {(visibleSections === null || visibleSections.includes('detection')) && <ConfigSection
                title="Detection Rules"
                icon={<FileCode className="w-4 h-4" />}
                expanded={expandedSection === 'detection'}
                onToggle={() => toggleSection('detection')}
              >
                <div className="space-y-3">
                  {config.detectionRules.length === 0 ? (
                    <p className="text-text-muted text-sm italic">No detection rules configured</p>
                  ) : (
                    config.detectionRules.map((rule, index) => (
                      <div key={index} className="bg-bg-elevated/50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-0.5 bg-accent-cyan/10 text-accent-cyan text-xs font-medium rounded uppercase">
                            {rule.type}
                          </span>
                        </div>
                        <DetectionRuleDisplay rule={rule} />
                      </div>
                    ))
                  )}
                  <p className="text-text-muted text-xs">
                    Detection rules are auto-generated based on installer type. They determine how Intune verifies the app is installed.
                  </p>
                </div>
              </ConfigSection>}

              {/* Assignment Configuration (quick + advanced) */}
              {(visibleSections === null || visibleSections.includes('assignment')) && <ConfigSection
                title="Assignment Configuration"
                icon={<Target className="w-4 h-4" />}
                expanded={expandedSection === 'assignment'}
                onToggle={() => toggleSection('assignment')}
              >
                <AssignmentConfig
                  assignments={assignments}
                  onChange={setAssignments}
                />
              </ConfigSection>}

              {/* Category Configuration (quick + advanced) */}
              {(visibleSections === null || visibleSections.includes('category')) && <ConfigSection
                title="Category Configuration"
                icon={<FolderTree className="w-4 h-4" />}
                expanded={expandedSection === 'category'}
                onToggle={() => toggleSection('category')}
              >
                <CategoryConfig
                  categories={categories}
                  onChange={setCategories}
                />
              </ConfigSection>}

              {/* Teaser for quick mode */}
              {configMode === 'quick' && (
                <button
                  onClick={() => setConfigMode('advanced')}
                  className="w-full py-3 px-4 rounded-lg border border-dashed border-overlay/15 text-sm text-text-secondary hover:text-text-primary hover:border-overlay/25 transition-colors text-center"
                >
                  8 more configuration sections available
                </button>
              )}

              {/* Branding (advanced only) */}
              {(visibleSections === null || visibleSections.includes('branding')) && <ConfigSection
                title="Branding"
                icon={<Palette className="w-4 h-4" />}
                expanded={expandedSection === 'branding'}
                onToggle={() => toggleSection('branding')}
              >
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Company name
                    </label>
                    <input
                      type="text"
                      value={config.brandingCompanyName || ''}
                      onChange={(e) => updateConfig({ brandingCompanyName: e.target.value || undefined })}
                      placeholder="PSAppDeployToolkit (default)"
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Welcome dialog title (optional)
                    </label>
                    <input
                      type="text"
                      value={config.brandingWelcomeTitle || ''}
                      onChange={(e) => updateConfig({ brandingWelcomeTitle: e.target.value || undefined })}
                      placeholder={`${pkg.name} Installation`}
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Welcome dialog custom message
                    </label>
                    <textarea
                      value={config.brandingWelcomeMessage || ''}
                      onChange={(e) => updateConfig({ brandingWelcomeMessage: e.target.value || undefined })}
                      rows={3}
                      placeholder="Optional message for the installation welcome prompt"
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Fluent accent color
                    </label>
                    <input
                      type="text"
                      value={config.brandingAccentColor || ''}
                      onChange={(e) => updateConfig({ brandingAccentColor: e.target.value || undefined })}
                      placeholder="0xFF0078D7 or #0078D7"
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm font-mono"
                    />
                    <p className="text-text-muted text-xs mt-1">
                      Supports hex values like 0xFF0078D7 or standard color names.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Logo path / URL
                    </label>
                    <input
                      type="text"
                      value={config.brandingLogoPath || ''}
                      onChange={(e) => updateConfig({ brandingLogoPath: e.target.value || undefined })}
                      placeholder="Leave empty to keep default logo"
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Dark mode logo path / URL
                    </label>
                    <input
                      type="text"
                      value={config.brandingLogoDarkPath || ''}
                      onChange={(e) => updateConfig({ brandingLogoDarkPath: e.target.value || undefined })}
                      placeholder="Optional dark mode logo"
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Banner path / URL
                    </label>
                    <input
                      type="text"
                      value={config.brandingBannerPath || ''}
                      onChange={(e) => updateConfig({ brandingBannerPath: e.target.value || undefined })}
                      placeholder="Optional classic UI banner"
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                    />
                  </div>
                </div>
              </ConfigSection>}

              {/* Advanced (advanced only) */}
              {(visibleSections === null || visibleSections.includes('advanced')) && <ConfigSection
                title="Advanced Options"
                icon={<Terminal className="w-4 h-4" />}
                expanded={expandedSection === 'advanced'}
                onToggle={() => toggleSection('advanced')}
              >
                <div className="space-y-4">
                  {/* Custom Install Command */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Install command override
                    </label>
                    <input
                      type="text"
                      value={config.installCommand || ''}
                      onChange={(e) => updateConfig({ installCommand: e.target.value || undefined })}
                      placeholder={selectedInstaller ? generateInstallCommand(selectedInstaller, selectedScope) : ''}
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm font-mono"
                    />
                    <p className="text-text-muted text-xs mt-1">Leave empty to use auto-generated command</p>
                  </div>

                  {/* Custom Uninstall Command */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Uninstall command override
                    </label>
                    <input
                      type="text"
                      value={config.uninstallCommand || ''}
                      onChange={(e) => updateConfig({ uninstallCommand: e.target.value || undefined })}
                      placeholder={selectedInstaller ? generateUninstallCommand(selectedInstaller, pkg.name) : ''}
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm font-mono"
                    />
                  </div>
                </div>
              </ConfigSection>}

            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-overlay/10 p-4 bg-bg-surface/95 space-y-2">
          {settingsSuccess && (
            <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-400">
              <Check className="w-4 h-4" />
              Settings updated successfully
            </div>
          )}
          {settingsError && (
            <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
              <X className="w-4 h-4" />
              {settingsError}
            </div>
          )}
          {canUpdateSettings ? (
            <div className="space-y-2">
              {!changeState.hasGraphChanges && !settingsSuccess && !isUpdating && (
                <p className="text-text-muted text-xs text-center">
                  No assignment or category changes to apply
                </p>
              )}
              <div className="flex gap-3">
                <Button
                  onClick={handleUpdateSettings}
                  disabled={isUpdating || settingsSuccess || !changeState.hasGraphChanges}
                  className={cn(
                    'flex-1 py-5 text-base font-medium',
                    !changeState.hasGraphChanges && !settingsSuccess
                      ? 'bg-accent-cyan/50 text-white/60 cursor-not-allowed'
                      : 'bg-accent-cyan hover:bg-accent-cyan-dim text-white'
                  )}
                >
                  {isUpdating ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : settingsSuccess ? (
                    <>
                      <Check className="w-5 h-5 mr-2" />
                      Updated
                    </>
                  ) : (
                    <>
                      <Settings className="w-5 h-5 mr-2" />
                      Update Settings
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleAddToCart}
                  disabled={!selectedInstaller || inCart || isAddingToCart || addedToCartSuccess}
                  variant="outline"
                  className={cn(
                    'py-5 text-base font-medium',
                    inCart || addedToCartSuccess
                      ? 'border-green-500/20 text-green-400 hover:bg-green-600/10'
                      : 'border-overlay/15 text-text-primary hover:bg-overlay/10'
                  )}
                >
                  {isAddingToCart ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : inCart || addedToCartSuccess ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <>
                      <RefreshCw className="w-5 h-5 mr-2" />
                      Redeploy
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              onClick={handleAddToCart}
              disabled={!selectedInstaller || inCart || isAddingToCart || addedToCartSuccess}
              className={cn(
                'w-full py-5 text-base font-medium',
                inCart || addedToCartSuccess
                  ? 'bg-green-600/10 text-green-400 hover:bg-green-600/10 cursor-default'
                  : 'bg-accent-cyan hover:bg-accent-cyan-dim text-white'
              )}
            >
              {isAddingToCart ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Adding...
                </>
              ) : inCart || addedToCartSuccess ? (
                <Check className="w-5 h-5" />
              ) : isDeployed ? (
                <>
                  <RefreshCw className="w-5 h-5 mr-2" />
                  Add to Selection (Redeploy)
                </>
              ) : (
                <>
                  <Plus className="w-5 h-5 mr-2" />
                  Add to Selection
                </>
              )}
            </Button>
          )}
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
  const sectionId = useId();
  const contentId = `${sectionId}-content`;
  const headerId = `${sectionId}-header`;

  return (
    <div className="border border-overlay/10 rounded-lg overflow-hidden mb-3">
      <button
        id={headerId}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={contentId}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-elevated/50 hover:bg-overlay/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-cyan"
      >
        <div className="flex items-center gap-2 text-text-primary">
          {icon}
          <span className="font-medium">{title}</span>
        </div>
        <ChevronRight className={cn('w-4 h-4 text-text-muted transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div id={contentId} role="region" aria-labelledby={headerId} className="p-4 bg-bg-surface/50">
          {children}
        </div>
      )}
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
  const toggleId = useId();

  return (
    <div className="flex items-start gap-3">
      <div className="pt-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={label ? `${toggleId}-label` : undefined}
          aria-describedby={description ? `${toggleId}-desc` : undefined}
          onClick={() => onChange(!checked)}
          className={cn(
            'w-10 h-6 rounded-full transition-colors relative cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface',
            checked ? 'bg-accent-cyan' : 'bg-overlay/15'
          )}
        >
          <div
            className={cn(
              'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
              checked ? 'translate-x-5' : 'translate-x-1'
            )}
          />
        </button>
      </div>
      <div className="cursor-pointer" onClick={() => onChange(!checked)}>
        {label && <span id={`${toggleId}-label`} className="text-text-primary text-sm font-medium">{label}</span>}
        {description && <p id={`${toggleId}-desc`} className="text-text-muted text-xs">{description}</p>}
      </div>
    </div>
  );
}

function DetectionRuleDisplay({ rule }: { rule: DetectionRule }) {
  if (rule.type === 'registry') {
    const r = rule as DetectionRule & { keyPath?: string; valueName?: string; detectionValue?: string; operator?: string };
    return (
      <div className="space-y-1 text-xs">
        {r.keyPath && (
          <div className="flex gap-2">
            <span className="text-text-muted font-medium min-w-[4rem]">Path</span>
            <span className="text-text-primary font-mono break-all">{r.keyPath}</span>
          </div>
        )}
        {r.valueName && (
          <div className="flex gap-2">
            <span className="text-text-muted font-medium min-w-[4rem]">Value</span>
            <span className="text-text-primary font-mono">{r.valueName}</span>
          </div>
        )}
        {r.operator && (
          <div className="flex gap-2">
            <span className="text-text-muted font-medium min-w-[4rem]">Operator</span>
            <span className="text-text-primary">{r.operator}</span>
          </div>
        )}
        {r.detectionValue && (
          <div className="flex gap-2">
            <span className="text-text-muted font-medium min-w-[4rem]">Expected</span>
            <span className="text-text-primary font-mono">{r.detectionValue}</span>
          </div>
        )}
      </div>
    );
  }

  if (rule.type === 'file') {
    const f = rule as DetectionRule & { path?: string; fileOrFolderName?: string; detectionValue?: string; operator?: string };
    return (
      <div className="space-y-1 text-xs">
        {f.path && (
          <div className="flex gap-2">
            <span className="text-text-muted font-medium min-w-[4rem]">Path</span>
            <span className="text-text-primary font-mono break-all">{f.path}</span>
          </div>
        )}
        {f.fileOrFolderName && (
          <div className="flex gap-2">
            <span className="text-text-muted font-medium min-w-[4rem]">File</span>
            <span className="text-text-primary font-mono">{f.fileOrFolderName}</span>
          </div>
        )}
        {f.operator && f.detectionValue && (
          <div className="flex gap-2">
            <span className="text-text-muted font-medium min-w-[4rem]">Version</span>
            <span className="text-text-primary">{f.operator} {f.detectionValue}</span>
          </div>
        )}
      </div>
    );
  }

  if (rule.type === 'msi') {
    const m = rule as DetectionRule & { productCode?: string; productVersionOperator?: string; productVersion?: string };
    return (
      <div className="space-y-1 text-xs">
        {m.productCode && (
          <div className="flex gap-2">
            <span className="text-text-muted font-medium min-w-[5.5rem]">Product Code</span>
            <span className="text-text-primary font-mono break-all">{m.productCode}</span>
          </div>
        )}
        {m.productVersionOperator && m.productVersion && (
          <div className="flex gap-2">
            <span className="text-text-muted font-medium min-w-[5.5rem]">Version</span>
            <span className="text-text-primary">{m.productVersionOperator} {m.productVersion}</span>
          </div>
        )}
      </div>
    );
  }

  // Fallback for unknown types
  return (
    <pre className="text-text-muted text-xs font-mono whitespace-pre-wrap break-all">
      {JSON.stringify(rule, null, 2)}
    </pre>
  );
}
