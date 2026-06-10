'use client';

import { useState } from 'react';
import {
  X,
  Settings,
  Terminal,
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
  Shield,
  Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AssignmentConfig } from '@/components/AssignmentConfig';
import { CategoryConfig } from '@/components/CategoryConfig';
import { DependencyConfig } from '@/components/DependencyConfig';
import { EspProfileSelector } from '@/components/EspProfileSelector';
import type { CartItem, StoreCartItem, IntuneAppCategorySelection, PackageAssignment } from '@/types/upload';
import type { EspProfileSelection } from '@/types/esp';
import { isStoreCartItem, isWin32CartItem } from '@/types/upload';
import type { RequirementRule, AppRelationship } from '@/types/intune';
import type {
  PSADTConfig,
  ProcessToClose,
  RestartBehavior,
  DeployMode,
  DialogPosition,
  DialogIcon,
  BalloonIcon,
  CustomPrompt,
  BalloonTipConfig,
} from '@/types/psadt';
import type { WingetScope } from '@/types/winget';
import { useCartStore } from '@/stores/cart-store';
import { generateRequirementRules } from '@/lib/requirement-rules';

interface CartItemConfigProps {
  item: CartItem;
  onClose: () => void;
}

type ConfigSection =
  | 'behavior'
  | 'deferral'
  | 'progress'
  | 'prompts'
  | 'restart'
  | 'diskspace'
  | 'assignment'
  | 'category'
  | 'esp'
  | 'dependencies'
  | 'branding'
  | 'advanced';

export function CartItemConfig({ item, onClose }: CartItemConfigProps) {
  const updateItem = useCartStore((state) => state.updateItem);
  const isStore = isStoreCartItem(item);
  const isWin32 = isWin32CartItem(item);

  // Store app state
  const [storeInstallExperience, setStoreInstallExperience] = useState<'user' | 'system'>(
    isStore ? (item as StoreCartItem).installExperience : 'user'
  );

  // Local state for editing (win32-specific fields use safe defaults for store items)
  const [selectedScope, setSelectedScope] = useState<WingetScope>(
    isWin32 ? item.installScope : 'machine'
  );
  const [config, setConfig] = useState<PSADTConfig>(() =>
    isWin32 ? { ...item.psadtConfig } : ({} as PSADTConfig)
  );
  const [assignments, setAssignments] = useState<PackageAssignment[]>(
    item.assignments || []
  );
  const [categories, setCategories] = useState<IntuneAppCategorySelection[]>(
    item.categories || []
  );
  const [espProfiles, setEspProfiles] = useState<EspProfileSelection[]>(
    item.espProfiles || []
  );
  const [relationships, setRelationships] = useState<AppRelationship[]>(
    item.relationships || []
  );
  const [installCommand, setInstallCommand] = useState(isWin32 ? item.installCommand : '');
  const [uninstallCommand, setUninstallCommand] = useState(isWin32 ? item.uninstallCommand : '');

  // UI state
  const [expandedSection, setExpandedSection] = useState<ConfigSection | null>(isStore ? 'assignment' : 'behavior');
  const [isSaving, setIsSaving] = useState(false);

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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (isStore) {
        // Store apps: only update install experience, assignments, categories, ESP
        updateItem(item.id, {
          installExperience: storeInstallExperience,
          assignments: assignments.length > 0 ? assignments : undefined,
          categories: categories.length > 0 ? categories : undefined,
          espProfiles: espProfiles.length > 0 ? espProfiles : undefined,
        } as Partial<StoreCartItem>);
      } else {
        // Win32 apps: full config update
        // Generate requirement rules if any assignment uses "Update Only"
        let requirementRules: RequirementRule[] | undefined;
        if (isWin32 && assignments.some((a) => a.intent === 'updateOnly')) {
          requirementRules = generateRequirementRules(
            item.displayName,
            item.installerType
          );
        }

        updateItem(item.id, {
          installScope: selectedScope,
          psadtConfig: config,
          assignments: assignments.length > 0 ? assignments : undefined,
          categories: categories.length > 0 ? categories : undefined,
          espProfiles: espProfiles.length > 0 ? espProfiles : undefined,
          relationships: relationships.length > 0 ? relationships : undefined,
          requirementRules,
          installCommand,
          uninstallCommand,
        });
      }
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-bg-surface border-l border-overlay/10 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 bg-bg-surface/95 backdrop-blur-sm border-b border-overlay/10 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-bg-elevated to-bg-surface flex items-center justify-center flex-shrink-0 border border-white/5">
                <Settings className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-text-primary">Edit Configuration</h2>
                <p className="text-text-muted text-sm">{item.displayName}</p>
                <p className="text-text-muted text-xs font-mono mt-1">{item.wingetId}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Read-only info */}
            <div className="bg-bg-elevated/50 rounded-lg p-4 border border-overlay/15">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {!isStore && (
                  <div>
                    <span className="text-text-muted">Version</span>
                    <p className="text-text-primary font-medium">v{item.version}</p>
                  </div>
                )}
                {isStore ? (
                  <div>
                    <span className="text-text-muted">Type</span>
                    <p className="text-violet-300 font-medium">Microsoft Store</p>
                  </div>
                ) : isWin32 ? (
                  <>
                    <div>
                      <span className="text-text-muted">Architecture</span>
                      <p className="text-text-primary font-medium">{item.architecture}</p>
                    </div>
                    <div>
                      <span className="text-text-muted">Installer Type</span>
                      <p className="text-text-primary font-medium uppercase">{item.installerType}</p>
                    </div>
                  </>
                ) : null}
                <div>
                  <span className="text-text-muted">Publisher</span>
                  <p className="text-text-primary font-medium">{item.publisher}</p>
                </div>
              </div>
              <p className="text-text-muted text-xs mt-3">
                {isStore
                  ? 'Store app settings. Remove and re-add to change app selection.'
                  : 'Version and architecture cannot be changed. Remove and re-add the app to select different options.'}
              </p>
            </div>

            {/* Store app: Install Experience */}
            {isStore && (
              <div>
                <label className="block text-sm font-medium text-text-muted mb-2">Install Experience</label>
                <div className="flex gap-2">
                  {(['user', 'system'] as const).map((exp) => (
                    <button
                      key={exp}
                      onClick={() => setStoreInstallExperience(exp)}
                      className={cn(
                        'flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors',
                        storeInstallExperience === exp
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-bg-elevated border-overlay/15 text-text-primary hover:border-overlay/20'
                      )}
                    >
                      {exp === 'user' ? 'Per-User' : 'Per-System'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Win32 app: Install Scope */}
            {isWin32 && (
              <div>
                <label className="block text-sm font-medium text-text-muted mb-2">Install Scope</label>
                <div className="flex gap-2">
                  {(['machine', 'user'] as WingetScope[]).map((scope) => {
                    const label = scope === 'machine' ? 'Per-Machine' : 'Per-User';
                    return (
                      <button
                        key={scope}
                        onClick={() => setSelectedScope(scope)}
                        className={cn(
                          'flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors',
                          selectedScope === scope
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-bg-elevated border-overlay/15 text-text-primary hover:border-overlay/20'
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="border-t border-overlay/10 pt-6">
              {isWin32 && <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-400" />
                Deployment Configuration
              </h3>}

              {/* Installation Behavior (win32 only) */}
              {isWin32 && <ConfigSection
                title="Installation Behavior"
                icon={<Settings className="w-4 h-4" />}
                expanded={expandedSection === 'behavior'}
                onToggle={() => toggleSection('behavior')}
              >
                <div className="space-y-4">
                  {/* Deploy Mode */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Deploy mode
                    </label>
                    <select
                      value={config.deployMode || 'Silent'}
                      onChange={(e) => updateConfig({ deployMode: e.target.value as DeployMode })}
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm"
                    >
                      <option value="Silent">Silent - No UI popups (recommended)</option>
                      <option value="NonInteractive">Non-Interactive - Show progress only</option>
                      <option value="Auto">Auto-detect (PSADT default)</option>
                    </select>
                    <p className="text-xs text-text-muted mt-1">
                      Controls whether PSADT shows dialogs during installation. Silent is recommended for Intune.
                    </p>
                  </div>

                  {/* Remove Existing Install Toggle */}
                  <ToggleOption
                    label="Remove existing installation first"
                    description="Uninstalls any detected existing installation of this application before installing. Use when upgrades fail because a previous version is present."
                    checked={config.removeExistingInstall || false}
                    onChange={(checked) => updateConfig({ removeExistingInstall: checked })}
                  />

                  {/* Detection Marker Registry Path */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">
                      Detection marker registry path
                    </label>
                    <input
                      type="text"
                      value={config.registryMarkerPath || ''}
                      onChange={(e) => updateConfig({ registryMarkerPath: e.target.value || undefined })}
                      placeholder="SOFTWARE\IntuneGet\Apps"
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/10 rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/50"
                    />
                    <p className="text-xs text-text-muted mt-1">
                      Registry key under HKLM/HKCU where the detection marker is written. Customize to track deployments under your own key, e.g. SOFTWARE\CompanyName\Apps. The detection rule updates automatically on save.
                    </p>
                  </div>

                  {/* Processes to Close */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-text-secondary">
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

              {/* Deferral Settings (win32 only) */}
              {isWin32 && <ConfigSection
                title="Deferral Settings"
                icon={<Clock className="w-4 h-4" />}
                expanded={expandedSection === 'deferral'}
                onToggle={() => toggleSection('deferral')}
              >
                <div className="space-y-4">
                  <ToggleOption
                    label="Allow users to defer installation"
                    description="Let users postpone the installation to a later time"
                    checked={config.allowDefer}
                    onChange={(checked) => updateConfig({ allowDefer: checked })}
                  />

                  {config.allowDefer && (
                    <div className="ml-6 border-l-2 border-overlay/15 pl-4 space-y-4">
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
                      </div>
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
                      </div>
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
                      </div>
                    </div>
                  )}
                </div>
              </ConfigSection>}

              {/* Progress & Notifications (win32 only) */}
              {isWin32 && <ConfigSection
                title="Progress & Notifications"
                icon={<Bell className="w-4 h-4" />}
                expanded={expandedSection === 'progress'}
                onToggle={() => toggleSection('progress')}
              >
                <div className="space-y-4">
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

                  {/* Balloon Tips */}
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
                        className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
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

              {/* Custom Prompts (win32 only) */}
              {isWin32 && <ConfigSection
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
                      className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" />
                      Add
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

              {/* Restart Prompt (win32 only) */}
              {isWin32 && <ConfigSection
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
                      </div>
                    </div>
                  )}
                </div>
              </ConfigSection>}

              {/* Disk Space Check (win32 only) */}
              {isWin32 && <ConfigSection
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
                    </div>
                  )}
                </div>
              </ConfigSection>}

              {/* Assignment Configuration (all app types) */}
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

              {/* Category Configuration */}
              <ConfigSection
                title="Category Configuration"
                icon={<FolderTree className="w-4 h-4" />}
                expanded={expandedSection === 'category'}
                onToggle={() => toggleSection('category')}
              >
                <CategoryConfig
                  categories={categories}
                  onChange={setCategories}
                />
              </ConfigSection>

              {/* ESP Configuration */}
              <ConfigSection
                title="Enrollment Status Page"
                icon={<Shield className="w-4 h-4" />}
                expanded={expandedSection === 'esp'}
                onToggle={() => toggleSection('esp')}
              >
                <EspProfileSelector
                  espProfiles={espProfiles}
                  onChange={setEspProfiles}
                  mode="pre-deploy"
                  hasRequiredAssignment={assignments.some((a) => a.intent === 'required')}
                />
              </ConfigSection>

              {/* Dependencies & Supersedence (win32 only) */}
              {isWin32 && <ConfigSection
                title="Dependencies & Supersedence"
                icon={<Link2 className="w-4 h-4" />}
                expanded={expandedSection === 'dependencies'}
                onToggle={() => toggleSection('dependencies')}
              >
                <DependencyConfig
                  relationships={relationships}
                  onChange={setRelationships}
                />
              </ConfigSection>}

              {/* Branding (win32 only) */}
              {isWin32 && <ConfigSection
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
                      placeholder={`${item.displayName} Installation`}
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

              {/* Advanced (win32 only) */}
              {isWin32 && <ConfigSection
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
                      value={installCommand}
                      onChange={(e) => setInstallCommand(e.target.value)}
                      placeholder="Leave empty to use default"
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm font-mono"
                    />
                    <p className="text-text-muted text-xs mt-1">Override the auto-generated install command</p>
                  </div>

                  {/* Custom Uninstall Command */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Uninstall command override
                    </label>
                    <input
                      type="text"
                      value={uninstallCommand}
                      onChange={(e) => setUninstallCommand(e.target.value)}
                      placeholder="Leave empty to use default"
                      className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm font-mono"
                    />
                    <p className="text-text-muted text-xs mt-1">Override the auto-generated uninstall command</p>
                  </div>
                </div>
              </ConfigSection>}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-overlay/10 p-4 bg-bg-surface/95">
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-overlay/15 text-text-secondary hover:bg-white/5 hover:border-overlay/20"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
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
    <div className="border border-overlay/10 rounded-lg overflow-hidden mb-3">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-elevated/50 hover:bg-overlay/10 transition-colors"
      >
        <div className="flex items-center gap-2 text-text-primary">
          {icon}
          <span className="font-medium">{title}</span>
        </div>
        <ChevronRight className={cn('w-4 h-4 text-text-muted transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && <div className="p-4 bg-bg-surface/50">{children}</div>}
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
            checked ? 'bg-blue-600' : 'bg-overlay/15'
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
        <span className="text-text-primary text-sm font-medium">{label}</span>
        <p className="text-text-muted text-xs">{description}</p>
      </div>
    </label>
  );
}
