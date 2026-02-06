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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AssignmentConfig } from '@/components/AssignmentConfig';
import type { CartItem, PackageAssignment } from '@/types/upload';
import type {
  PSADTConfig,
  ProcessToClose,
  RestartBehavior,
  DialogPosition,
  DialogIcon,
  BalloonIcon,
  CustomPrompt,
  BalloonTipConfig,
} from '@/types/psadt';
import type { WingetScope } from '@/types/winget';
import { useCartStore } from '@/stores/cart-store';

interface CartItemConfigProps {
  item: CartItem;
  onClose: () => void;
}

type ConfigSection = 'behavior' | 'deferral' | 'progress' | 'prompts' | 'restart' | 'diskspace' | 'assignment' | 'advanced';

export function CartItemConfig({ item, onClose }: CartItemConfigProps) {
  const updateItem = useCartStore((state) => state.updateItem);

  // Local state for editing
  const [selectedScope, setSelectedScope] = useState<WingetScope>(item.installScope);
  const [config, setConfig] = useState<PSADTConfig>(() => ({
    ...item.psadtConfig,
  }));
  const [assignments, setAssignments] = useState<PackageAssignment[]>(
    item.assignments || []
  );
  const [installCommand, setInstallCommand] = useState(item.installCommand);
  const [uninstallCommand, setUninstallCommand] = useState(item.uninstallCommand);

  // UI state
  const [expandedSection, setExpandedSection] = useState<ConfigSection | null>('behavior');
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
      updateItem(item.id, {
        installScope: selectedScope,
        psadtConfig: config,
        assignments: assignments.length > 0 ? assignments : undefined,
        installCommand,
        uninstallCommand,
      });
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
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-slate-900 border-l border-slate-800 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-bg-elevated to-bg-surface flex items-center justify-center flex-shrink-0 border border-white/5">
                <Settings className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Edit Configuration</h2>
                <p className="text-slate-400 text-sm">{item.displayName}</p>
                <p className="text-slate-600 text-xs font-mono mt-1">{item.wingetId}</p>
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
            {/* Read-only info */}
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-slate-500">Version</span>
                  <p className="text-white font-medium">v{item.version}</p>
                </div>
                <div>
                  <span className="text-slate-500">Architecture</span>
                  <p className="text-white font-medium">{item.architecture}</p>
                </div>
                <div>
                  <span className="text-slate-500">Installer Type</span>
                  <p className="text-white font-medium uppercase">{item.installerType}</p>
                </div>
                <div>
                  <span className="text-slate-500">Publisher</span>
                  <p className="text-white font-medium">{item.publisher}</p>
                </div>
              </div>
              <p className="text-slate-500 text-xs mt-3">
                Version and architecture cannot be changed. Remove and re-add the app to select different options.
              </p>
            </div>

            {/* Install Scope */}
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Install Scope</label>
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
                          : 'bg-slate-800 border-slate-700 text-white hover:border-slate-600'
                      )}
                    >
                      {label}
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
                          <div key={index} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
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
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Dialog position
                    </label>
                    <select
                      value={config.windowLocation || 'Default'}
                      onChange={(e) => updateConfig({ windowLocation: e.target.value as DialogPosition })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
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
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Restart behavior
                    </label>
                    <select
                      value={config.restartBehavior}
                      onChange={(e) => updateConfig({ restartBehavior: e.target.value as RestartBehavior })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                    >
                      <option value="Suppress">Suppress restart (recommended)</option>
                      <option value="Prompt">Prompt user to restart</option>
                      <option value="Force">Force restart</option>
                    </select>
                  </div>
                </div>
              </ConfigSection>

              {/* Deferral Settings */}
              <ConfigSection
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
                    <div className="ml-6 border-l-2 border-slate-700 pl-4 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          Maximum deferrals allowed
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="99"
                          value={config.deferTimes || 3}
                          onChange={(e) => updateConfig({ deferTimes: parseInt(e.target.value) || 3 })}
                          className="w-24 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          Deferral days limit (optional)
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="365"
                          value={config.deferDays || ''}
                          onChange={(e) => updateConfig({ deferDays: e.target.value ? parseInt(e.target.value) : undefined })}
                          placeholder="No limit"
                          className="w-24 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          Deferral deadline (optional)
                        </label>
                        <input
                          type="date"
                          value={config.deferDeadline || ''}
                          onChange={(e) => updateConfig({ deferDeadline: e.target.value || undefined })}
                          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
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
                            className="w-24 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                          />
                          <span className="text-slate-400 text-sm">seconds</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </ConfigSection>

              {/* Progress & Notifications */}
              <ConfigSection
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
                    <div className="ml-6 border-l-2 border-slate-700 pl-4 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          Status message (optional)
                        </label>
                        <input
                          type="text"
                          value={config.progressDialog?.statusMessage || ''}
                          onChange={(e) => updateConfig({
                            progressDialog: { ...config.progressDialog, enabled: true, statusMessage: e.target.value || undefined }
                          })}
                          placeholder="Installing application..."
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          Window position
                        </label>
                        <select
                          value={config.progressDialog?.windowLocation || 'Default'}
                          onChange={(e) => updateConfig({
                            progressDialog: { ...config.progressDialog, enabled: true, windowLocation: e.target.value as DialogPosition }
                          })}
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                        >
                          <option value="Default">Default</option>
                          <option value="Center">Center</option>
                          <option value="BottomRight">Bottom Right</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Balloon Tips */}
                  <div className="border-t border-slate-700 pt-4 mt-4">
                    <div className="flex items-center justify-between mb-3">
                      <label className="block text-sm font-medium text-slate-300">
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
                      <p className="text-slate-500 text-sm italic">No balloon notifications configured</p>
                    ) : (
                      <div className="space-y-3">
                        {config.balloonTips.map((tip, index) => (
                          <div key={index} className="bg-slate-800/50 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-white">Notification {index + 1}</span>
                              <button
                                onClick={() => {
                                  const newTips = config.balloonTips.filter((_, i) => i !== index);
                                  updateConfig({ balloonTips: newTips });
                                }}
                                className="text-slate-500 hover:text-red-400 transition-colors"
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
                                className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm"
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
                                className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm"
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
                              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm"
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
                              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </ConfigSection>

              {/* Custom Prompts */}
              <ConfigSection
                title="Custom Prompts"
                icon={<MessageSquare className="w-4 h-4" />}
                expanded={expandedSection === 'prompts'}
                onToggle={() => toggleSection('prompts')}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-slate-400 text-sm">Add custom dialog prompts at specific points during installation.</p>
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
                    <p className="text-slate-500 text-sm italic">No custom prompts configured</p>
                  ) : (
                    <div className="space-y-4">
                      {config.customPrompts.map((prompt, index) => (
                        <div key={index} className="bg-slate-800/50 rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-white">Prompt {index + 1}</span>
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
                                className="text-slate-500 hover:text-red-400 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-slate-400 mb-1">Timing</label>
                              <select
                                value={prompt.timing}
                                onChange={(e) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, timing: e.target.value as CustomPrompt['timing'] };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm"
                              >
                                <option value="pre-install">Before Install</option>
                                <option value="post-install">After Install</option>
                                <option value="pre-uninstall">Before Uninstall</option>
                                <option value="post-uninstall">After Uninstall</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-slate-400 mb-1">Icon</label>
                              <select
                                value={prompt.icon}
                                onChange={(e) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, icon: e.target.value as DialogIcon };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm"
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
                            <label className="block text-xs text-slate-400 mb-1">Title</label>
                            <input
                              type="text"
                              value={prompt.title}
                              onChange={(e) => {
                                const newPrompts = [...config.customPrompts];
                                newPrompts[index] = { ...prompt, title: e.target.value };
                                updateConfig({ customPrompts: newPrompts });
                              }}
                              placeholder="Dialog title"
                              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">Message</label>
                            <textarea
                              value={prompt.message}
                              onChange={(e) => {
                                const newPrompts = [...config.customPrompts];
                                newPrompts[index] = { ...prompt, message: e.target.value };
                                updateConfig({ customPrompts: newPrompts });
                              }}
                              placeholder="Dialog message"
                              rows={2}
                              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm resize-none"
                            />
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-xs text-slate-400 mb-1">Left Button</label>
                              <input
                                type="text"
                                value={prompt.buttonLeftText || ''}
                                onChange={(e) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, buttonLeftText: e.target.value || undefined };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                placeholder="Optional"
                                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-slate-400 mb-1">Middle Button</label>
                              <input
                                type="text"
                                value={prompt.buttonMiddleText || ''}
                                onChange={(e) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, buttonMiddleText: e.target.value || undefined };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                placeholder="Optional"
                                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-slate-400 mb-1">Right Button</label>
                              <input
                                type="text"
                                value={prompt.buttonRightText || ''}
                                onChange={(e) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, buttonRightText: e.target.value || undefined };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                placeholder="Continue"
                                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-slate-400 mb-1">Timeout (seconds)</label>
                              <input
                                type="number"
                                min="0"
                                value={prompt.timeout || 0}
                                onChange={(e) => {
                                  const newPrompts = [...config.customPrompts];
                                  newPrompts[index] = { ...prompt, timeout: parseInt(e.target.value) || 0 };
                                  updateConfig({ customPrompts: newPrompts });
                                }}
                                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm"
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
              </ConfigSection>

              {/* Restart Prompt */}
              <ConfigSection
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
                    <div className="ml-6 border-l-2 border-slate-700 pl-4 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
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
                          <span className="text-white text-sm font-mono w-16 text-right">
                            {config.restartPrompt?.countdownSeconds || 600}s
                          </span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
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
                          <span className="text-white text-sm font-mono w-16 text-right">
                            {config.restartPrompt?.countdownNoHideSeconds || 60}s
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </ConfigSection>

              {/* Disk Space Check */}
              <ConfigSection
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
                    <div className="ml-6 border-l-2 border-slate-700 pl-4">
                      <label className="block text-sm font-medium text-slate-300 mb-2">
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
                          className="w-32 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                        />
                        <span className="text-slate-400 text-sm">MB</span>
                      </div>
                    </div>
                  )}
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
                      value={installCommand}
                      onChange={(e) => setInstallCommand(e.target.value)}
                      placeholder="Leave empty to use default"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm font-mono"
                    />
                    <p className="text-slate-500 text-xs mt-1">Override the auto-generated install command</p>
                  </div>

                  {/* Custom Uninstall Command */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Uninstall command override
                    </label>
                    <input
                      type="text"
                      value={uninstallCommand}
                      onChange={(e) => setUninstallCommand(e.target.value)}
                      placeholder="Leave empty to use default"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm font-mono"
                    />
                    <p className="text-slate-500 text-xs mt-1">Override the auto-generated uninstall command</p>
                  </div>
                </div>
              </ConfigSection>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-slate-800 p-4 bg-slate-900/95">
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-slate-700 text-slate-300 hover:bg-white/5 hover:border-slate-600"
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
