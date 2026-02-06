'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type MspRole,
  getRoleDisplayName,
  getRoleDescription,
  getRoleColor,
  getAssignableRoles,
} from '@/lib/msp-permissions';

interface RoleSelectorProps {
  value: MspRole;
  onChange: (role: MspRole) => void;
  actorRole: MspRole;
  disabled?: boolean;
  excludeOwner?: boolean;
}

export function RoleSelector({
  value,
  onChange,
  actorRole,
  disabled = false,
  excludeOwner = true,
}: RoleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const assignableRoles = getAssignableRoles(actorRole);
  const availableRoles = excludeOwner
    ? assignableRoles.filter((r) => r !== 'owner')
    : assignableRoles;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (role: MspRole) => {
    onChange(role);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'flex items-center justify-between w-full px-3 py-2 text-sm border rounded-lg transition-colors',
          disabled
            ? 'bg-black/5 text-text-muted cursor-not-allowed'
            : 'bg-bg-elevated border-black/10 hover:border-black/20'
        )}
      >
        <span className={cn('font-medium', getRoleColor(value).split(' ')[0])}>
          {getRoleDisplayName(value)}
        </span>
        <ChevronDown
          className={cn(
            'w-4 h-4 text-text-muted transition-transform',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute z-20 w-full mt-1 bg-bg-elevated border border-black/10 rounded-lg shadow-xl overflow-hidden">
          {availableRoles.map((role) => (
            <button
              key={role}
              onClick={() => handleSelect(role)}
              className={cn(
                'w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-black/5 transition-colors',
                role === value && 'bg-accent-cyan/5'
              )}
            >
              <div className="flex-1">
                <span
                  className={cn(
                    'block text-sm font-medium',
                    getRoleColor(role).split(' ')[0]
                  )}
                >
                  {getRoleDisplayName(role)}
                </span>
                <span className="block text-xs text-text-muted">
                  {getRoleDescription(role)}
                </span>
              </div>
              {role === value && (
                <Check className="w-4 h-4 text-accent-cyan flex-shrink-0 mt-0.5" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default RoleSelector;
