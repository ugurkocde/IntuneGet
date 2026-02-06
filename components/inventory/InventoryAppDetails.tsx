'use client';

import { Package, Calendar, User, Terminal, AlertCircle, Loader2, RefreshCw, ExternalLink, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SlidePanel } from '@/components/dashboard/animations/SlidePanel';
import { useAppDetails } from '@/hooks/use-inventory';
import type { IntuneAppAssignment } from '@/types/inventory';

interface InventoryAppDetailsProps {
  appId: string | null;
  onClose: () => void;
  onUpdate?: (wingetId: string) => void;
}

export function InventoryAppDetails({ appId, onClose, onUpdate }: InventoryAppDetailsProps) {
  const { data, isLoading, error, refetch } = useAppDetails(appId);
  const app = data?.app;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(1)} MB`;
  };

  const getAssignmentIntent = (intent: IntuneAppAssignment['intent']) => {
    const intents: Record<string, { label: string; className: string }> = {
      required: { label: 'Required', className: 'bg-blue-50 text-blue-700' },
      available: { label: 'Available', className: 'bg-emerald-50 text-emerald-700' },
      uninstall: { label: 'Uninstall', className: 'bg-red-50 text-red-700' },
      availableWithoutEnrollment: { label: 'Available (Unenrolled)', className: 'bg-amber-50 text-amber-700' },
    };
    return intents[intent] || { label: intent, className: 'bg-black/5 text-text-muted' };
  };

  const customHeader = app ? (
    <div className="flex items-start gap-4 flex-1">
      <div className="w-12 h-12 rounded-xl bg-bg-elevated border border-black/5 flex items-center justify-center flex-shrink-0">
        {app.largeIcon?.value ? (
          <img
            src={`data:${app.largeIcon.type};base64,${app.largeIcon.value}`}
            alt={app.displayName}
            className="w-10 h-10 rounded-lg"
          />
        ) : (
          <Package className="w-6 h-6 text-text-muted" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-xl font-semibold text-text-primary truncate">{app.displayName}</h3>
        <p className="text-text-secondary text-sm">{app.publisher || 'Unknown Publisher'}</p>
        {app.displayVersion && (
          <span className="inline-block mt-1 text-xs bg-accent-cyan/10 text-accent-cyan px-2 py-0.5 rounded-full">
            v{app.displayVersion}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => refetch()}
        disabled={isLoading}
        className="text-text-secondary hover:text-text-primary flex-shrink-0"
      >
        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  ) : undefined;

  const footerContent = app && onUpdate ? (
    <Button
      onClick={() => onUpdate(app.displayName)}
      className="w-full bg-accent-cyan hover:bg-accent-cyan-bright text-white"
    >
      <RefreshCw className="w-4 h-4 mr-2" />
      Check for Update
    </Button>
  ) : undefined;

  return (
    <SlidePanel
      isOpen={!!appId}
      onClose={onClose}
      width="lg"
      direction="right"
      header={customHeader}
      footer={footerContent}
    >
      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-accent-cyan animate-spin" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="flex flex-col items-center justify-center py-12 text-text-secondary">
          <AlertCircle className="w-12 h-12 text-status-error mb-4" />
          <p className="text-text-primary font-medium">Failed to load app</p>
          <p className="text-sm mt-1">{error.message}</p>
          <Button
            variant="outline"
            className="mt-4 border-black/10"
            onClick={() => refetch()}
          >
            Try Again
          </Button>
        </div>
      )}

      {/* Content */}
      {app && (
        <div className="space-y-6">
          {/* Description */}
          {app.description && (
            <div>
              <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
                Description
              </h4>
              <p className="text-sm text-text-secondary leading-relaxed">{app.description}</p>
            </div>
          )}

          {/* Commands */}
          <div className="space-y-4">
            {app.installCommandLine && (
              <div>
                <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5" />
                  Install Command
                </h4>
                <div className="bg-bg-deepest rounded-lg p-3 border border-black/5">
                  <code className="block text-sm font-mono text-text-primary overflow-x-auto">
                    {app.installCommandLine}
                  </code>
                </div>
              </div>
            )}
            {app.uninstallCommandLine && (
              <div>
                <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5" />
                  Uninstall Command
                </h4>
                <div className="bg-bg-deepest rounded-lg p-3 border border-black/5">
                  <code className="block text-sm font-mono text-text-primary overflow-x-auto">
                    {app.uninstallCommandLine}
                  </code>
                </div>
              </div>
            )}
          </div>

          {/* Assignments */}
          {app.assignments && app.assignments.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
                <Users className="w-3.5 h-3.5" />
                Assignments ({app.assignments.length})
              </h4>
              <div className="space-y-2">
                {app.assignments.map((assignment) => {
                  const intentInfo = getAssignmentIntent(assignment.intent);
                  return (
                    <div
                      key={assignment.id}
                      className="flex items-center justify-between p-3 bg-bg-elevated rounded-lg border border-black/5"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-bg-surface flex items-center justify-center">
                          <Users className="w-4 h-4 text-text-muted" />
                        </div>
                        <div>
                          <p className="text-sm text-text-primary">
                            {assignment.target['@odata.type']?.includes('allDevices')
                              ? 'All Devices'
                              : assignment.target['@odata.type']?.includes('allUsers')
                              ? 'All Users'
                              : assignment.target.groupId
                              ? `Group: ${assignment.target.groupId.slice(0, 8)}...`
                              : 'Unknown Target'}
                          </p>
                        </div>
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${intentInfo.className}`}>
                        {intentInfo.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Metadata Grid */}
          <div>
            <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
              Details
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <MetadataItem
                icon={Calendar}
                label="Created"
                value={formatDate(app.createdDateTime)}
              />
              <MetadataItem
                icon={Calendar}
                label="Modified"
                value={formatDate(app.lastModifiedDateTime)}
              />
              <MetadataItem
                icon={Package}
                label="Size"
                value={formatSize(app.size)}
              />
              <MetadataItem
                icon={User}
                label="Run As"
                value={app.installExperience?.runAsAccount || 'System'}
              />
            </div>
          </div>

          {/* Additional Info */}
          {(app.developer || app.owner || app.notes) && (
            <div className="space-y-3 pt-4 border-t border-black/5">
              {app.developer && (
                <div>
                  <span className="text-sm text-text-muted">Developer: </span>
                  <span className="text-sm text-text-secondary">{app.developer}</span>
                </div>
              )}
              {app.owner && (
                <div>
                  <span className="text-sm text-text-muted">Owner: </span>
                  <span className="text-sm text-text-secondary">{app.owner}</span>
                </div>
              )}
              {app.notes && (
                <div>
                  <span className="text-sm text-text-muted">Notes: </span>
                  <span className="text-sm text-text-secondary">{app.notes}</span>
                </div>
              )}
            </div>
          )}

          {/* Links */}
          {(app.informationUrl || app.privacyInformationUrl) && (
            <div className="flex gap-3 pt-4 border-t border-black/5">
              {app.informationUrl && (
                <a
                  href={app.informationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent-cyan hover:text-accent-cyan-bright flex items-center gap-1"
                >
                  More Info <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {app.privacyInformationUrl && (
                <a
                  href={app.privacyInformationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent-cyan hover:text-accent-cyan-bright flex items-center gap-1"
                >
                  Privacy <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </SlidePanel>
  );
}

function MetadataItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-bg-elevated rounded-lg p-3 border border-black/5">
      <div className="flex items-center gap-2 text-text-muted mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-sm text-text-primary font-medium capitalize">{value}</p>
    </div>
  );
}
