'use client';

import { useState } from 'react';
import {
  FolderOpen,
  FileText,
  Settings,
  Link2,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Terminal,
  AlertCircle,
  Loader2,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Types matching the API response
interface RegistryEntry {
  key_name: string;
  registry_path?: string;
  display_name?: string;
  display_version?: string;
  publisher?: string;
  install_location?: string;
  uninstall_string?: string;
  quiet_uninstall_string?: string;
  estimated_size_kb?: number;
  detection_method?: string;
}

interface ShortcutEntry {
  name: string;
  path: string;
  created?: string;
  detection_method?: string;
}

interface ServiceEntry {
  name: string;
  display_name: string;
  start_type: string;
}

interface FileEntry {
  path: string;
  size: number;
  extension: string;
}

export interface ChangelogData {
  winget_id: string;
  version: string;
  scanned_at: string;
  scan_status: string;
  registry_changes: {
    added: RegistryEntry[];
    app_registry_entry?: RegistryEntry;
  };
  file_changes: {
    added: FileEntry[];
    file_count: number;
  };
  shortcuts_created: ShortcutEntry[];
  services_created: ServiceEntry[];
  install_path: string | null;
  uninstall_string: string | null;
  quiet_uninstall_string: string | null;
  installed_size_bytes: number | null;
}

interface ChangelogSummary {
  filesAdded: number;
  shortcutsCreated: number;
  servicesCreated: number;
  registryEntriesAdded: number;
  installedSizeMB: number | null;
}

interface InstallationChangelogProps {
  changelog: ChangelogData | null;
  summary: ChangelogSummary | null;
  isLoading?: boolean;
  error?: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function InstallationChangelog({
  changelog,
  summary,
  isLoading,
  error,
}: InstallationChangelogProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    summary: true,
    registry: false,
    files: false,
    shortcuts: false,
    services: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-accent-cyan animate-spin mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Loading installation details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 text-zinc-500 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!changelog || !summary) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Info className="w-8 h-8 text-zinc-500 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">
            Installation details not available for this package yet.
          </p>
          <p className="text-zinc-500 text-xs mt-1">
            Changelog data is generated when apps are scanned.
          </p>
        </div>
      </div>
    );
  }

  const registryEntry = changelog.registry_changes?.app_registry_entry;

  return (
    <div className="space-y-3">
      {/* Summary Section */}
      <CollapsibleSection
        title="Summary"
        icon={<Info className="w-4 h-4" />}
        expanded={expandedSections.summary}
        onToggle={() => toggleSection('summary')}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Files Added"
            value={summary.filesAdded.toLocaleString()}
            icon={<FileText className="w-4 h-4" />}
          />
          <StatCard
            label="Shortcuts"
            value={summary.shortcutsCreated.toString()}
            icon={<Link2 className="w-4 h-4" />}
          />
          <StatCard
            label="Services"
            value={summary.servicesCreated.toString()}
            icon={<Settings className="w-4 h-4" />}
          />
          <StatCard
            label="Installed Size"
            value={summary.installedSizeMB ? `${summary.installedSizeMB} MB` : 'N/A'}
            icon={<HardDrive className="w-4 h-4" />}
          />
        </div>

        {/* Install Path */}
        {changelog.install_path && (
          <div className="mt-4 p-3 bg-slate-800/50 rounded-lg">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <FolderOpen className="w-3 h-3" />
              <span>Install Path</span>
            </div>
            <code className="text-slate-300 text-sm font-mono break-all">
              {changelog.install_path}
            </code>
          </div>
        )}

        {/* Uninstall Commands */}
        {(changelog.uninstall_string || changelog.quiet_uninstall_string) && (
          <div className="mt-3 space-y-2">
            {changelog.uninstall_string && (
              <div className="p-3 bg-slate-800/50 rounded-lg">
                <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                  <Terminal className="w-3 h-3" />
                  <span>Uninstall Command</span>
                </div>
                <code className="text-slate-300 text-xs font-mono break-all block">
                  {changelog.uninstall_string}
                </code>
              </div>
            )}
            {changelog.quiet_uninstall_string && (
              <div className="p-3 bg-slate-800/50 rounded-lg">
                <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                  <Terminal className="w-3 h-3" />
                  <span>Quiet Uninstall Command</span>
                </div>
                <code className="text-slate-300 text-xs font-mono break-all block">
                  {changelog.quiet_uninstall_string}
                </code>
              </div>
            )}
          </div>
        )}

        {/* Scanned date */}
        <p className="text-zinc-500 text-xs mt-4">
          Scanned: {formatDate(changelog.scanned_at)}
        </p>
      </CollapsibleSection>

      {/* Registry Section */}
      {registryEntry && (
        <CollapsibleSection
          title="Registry Entry"
          icon={<Settings className="w-4 h-4" />}
          expanded={expandedSections.registry}
          onToggle={() => toggleSection('registry')}
          badge={changelog.registry_changes?.added?.length?.toString()}
        >
          <div className="space-y-3">
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {registryEntry.display_name && (
                  <div>
                    <span className="text-slate-500 text-xs">Display Name</span>
                    <p className="text-slate-300">{registryEntry.display_name}</p>
                  </div>
                )}
                {registryEntry.display_version && (
                  <div>
                    <span className="text-slate-500 text-xs">Version</span>
                    <p className="text-slate-300">{registryEntry.display_version}</p>
                  </div>
                )}
                {registryEntry.publisher && (
                  <div>
                    <span className="text-slate-500 text-xs">Publisher</span>
                    <p className="text-slate-300">{registryEntry.publisher}</p>
                  </div>
                )}
                {registryEntry.estimated_size_kb && (
                  <div>
                    <span className="text-slate-500 text-xs">Estimated Size</span>
                    <p className="text-slate-300">
                      {formatBytes(registryEntry.estimated_size_kb * 1024)}
                    </p>
                  </div>
                )}
              </div>
              {registryEntry.registry_path && (
                <div className="mt-3 pt-3 border-t border-slate-700">
                  <span className="text-slate-500 text-xs">Registry Path</span>
                  <code className="text-slate-400 text-xs font-mono break-all block mt-1">
                    {registryEntry.registry_path}
                  </code>
                </div>
              )}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Files Section */}
      {changelog.file_changes?.added?.length > 0 && (
        <CollapsibleSection
          title="Files Added"
          icon={<FileText className="w-4 h-4" />}
          expanded={expandedSections.files}
          onToggle={() => toggleSection('files')}
          badge={changelog.file_changes.file_count.toString()}
        >
          <div className="max-h-60 overflow-y-auto space-y-1">
            {changelog.file_changes.added.slice(0, 50).map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between py-1 px-2 hover:bg-slate-800/30 rounded text-xs"
              >
                <span className="text-slate-400 font-mono truncate flex-1 mr-2">
                  {file.path}
                </span>
                <span className="text-slate-500 flex-shrink-0">
                  {formatBytes(file.size)}
                </span>
              </div>
            ))}
            {changelog.file_changes.added.length > 50 && (
              <p className="text-slate-500 text-xs text-center py-2">
                + {changelog.file_changes.added.length - 50} more files
              </p>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Shortcuts Section */}
      {changelog.shortcuts_created?.length > 0 && (
        <CollapsibleSection
          title="Shortcuts Created"
          icon={<Link2 className="w-4 h-4" />}
          expanded={expandedSections.shortcuts}
          onToggle={() => toggleSection('shortcuts')}
          badge={changelog.shortcuts_created.length.toString()}
        >
          <div className="space-y-2">
            {changelog.shortcuts_created.map((shortcut, index) => (
              <div key={index} className="p-2 bg-slate-800/30 rounded">
                <p className="text-slate-300 text-sm">{shortcut.name}</p>
                <p className="text-slate-500 text-xs font-mono truncate">{shortcut.path}</p>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Services Section */}
      {changelog.services_created?.length > 0 && (
        <CollapsibleSection
          title="Services Created"
          icon={<Settings className="w-4 h-4" />}
          expanded={expandedSections.services}
          onToggle={() => toggleSection('services')}
          badge={changelog.services_created.length.toString()}
        >
          <div className="space-y-2">
            {changelog.services_created.map((service, index) => (
              <div key={index} className="p-2 bg-slate-800/30 rounded flex items-center justify-between">
                <div>
                  <p className="text-slate-300 text-sm">{service.display_name}</p>
                  <p className="text-slate-500 text-xs font-mono">{service.name}</p>
                </div>
                <span className="text-xs px-2 py-0.5 bg-slate-700 text-slate-400 rounded">
                  {service.start_type}
                </span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

// Sub-components

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  badge?: string;
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  icon,
  expanded,
  onToggle,
  badge,
  children,
}: CollapsibleSectionProps) {
  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/50 hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2 text-white">
          {icon}
          <span className="font-medium text-sm">{title}</span>
          {badge && (
            <span className="px-1.5 py-0.5 bg-slate-700 text-slate-300 text-xs rounded">
              {badge}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-400" />
        )}
      </button>
      {expanded && <div className="p-4 bg-slate-900/50">{children}</div>}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
}

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="p-3 bg-slate-800/50 rounded-lg">
      <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-white font-semibold">{value}</p>
    </div>
  );
}
