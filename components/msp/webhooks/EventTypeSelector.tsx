'use client';

import { CheckSquare, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

const EVENT_TYPES = [
  { id: 'deployment.completed', label: 'Deployment Completed', category: 'Deployments' },
  { id: 'deployment.failed', label: 'Deployment Failed', category: 'Deployments' },
  { id: 'batch.completed', label: 'Batch Completed', category: 'Deployments' },
  { id: 'member.joined', label: 'Member Joined', category: 'Team' },
  { id: 'member.removed', label: 'Member Removed', category: 'Team' },
  { id: 'consent.granted', label: 'Consent Granted', category: 'Tenants' },
  { id: 'consent.expired', label: 'Consent Expired', category: 'Tenants' },
  { id: 'consent.revoked', label: 'Consent Revoked', category: 'Tenants' },
];

interface EventTypeSelectorProps {
  selectedTypes: string[];
  onChange: (types: string[]) => void;
  disabled?: boolean;
}

export function EventTypeSelector({
  selectedTypes,
  onChange,
  disabled = false,
}: EventTypeSelectorProps) {
  const handleToggle = (eventId: string) => {
    if (disabled) return;

    if (selectedTypes.includes(eventId)) {
      onChange(selectedTypes.filter((id) => id !== eventId));
    } else {
      onChange([...selectedTypes, eventId]);
    }
  };

  const handleSelectAll = () => {
    if (disabled) return;
    onChange(EVENT_TYPES.map((e) => e.id));
  };

  const handleDeselectAll = () => {
    if (disabled) return;
    onChange([]);
  };

  // Group events by category
  const groupedEvents = EVENT_TYPES.reduce((acc, event) => {
    if (!acc[event.category]) {
      acc[event.category] = [];
    }
    acc[event.category].push(event);
    return acc;
  }, {} as Record<string, typeof EVENT_TYPES>);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">
          {selectedTypes.length} of {EVENT_TYPES.length} selected
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={disabled || selectedTypes.length === EVENT_TYPES.length}
            className="text-xs text-accent-cyan hover:text-accent-cyan-bright disabled:opacity-50"
          >
            Select all
          </button>
          <span className="text-text-muted">|</span>
          <button
            type="button"
            onClick={handleDeselectAll}
            disabled={disabled || selectedTypes.length === 0}
            className="text-xs text-accent-cyan hover:text-accent-cyan-bright disabled:opacity-50"
          >
            Deselect all
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {Object.entries(groupedEvents).map(([category, events]) => (
          <div key={category}>
            <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
              {category}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {events.map((event) => {
                const isSelected = selectedTypes.includes(event.id);
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => handleToggle(event.id)}
                    disabled={disabled}
                    className={cn(
                      'flex items-center gap-2 p-2 rounded-lg text-left transition-colors',
                      'border',
                      isSelected
                        ? 'border-accent-cyan/50 bg-accent-cyan/5'
                        : 'border-black/10 hover:border-black/20',
                      disabled && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-accent-cyan flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-text-muted flex-shrink-0" />
                    )}
                    <span className="text-sm text-text-primary">{event.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
