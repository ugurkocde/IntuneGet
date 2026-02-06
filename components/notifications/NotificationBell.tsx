'use client';

import { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUnreadCount } from '@/hooks/useNotifications';
import { NotificationCenter } from './NotificationCenter';
import { cn } from '@/lib/utils';

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const { data } = useUnreadCount();
  const unreadCount = data?.unread_count || 0;
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="ghost"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'relative text-text-secondary hover:text-text-primary hover:bg-black/5 transition-all',
          isOpen && 'text-text-primary bg-black/5'
        )}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-gradient-to-r from-accent-cyan to-accent-violet text-bg-elevated text-xs font-medium rounded-full flex items-center justify-center shadow-glow-cyan animate-scale-in">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop for mobile */}
          <div
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 sm:hidden"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown panel */}
          <div
            ref={dropdownRef}
            className={cn(
              'fixed sm:absolute z-50',
              'left-2 right-2 sm:left-auto sm:right-0 top-16 sm:top-full sm:mt-2',
              'animate-in fade-in-0 zoom-in-95 slide-in-from-top-2',
              'sm:w-auto'
            )}
          >
            <NotificationCenter onClose={() => setIsOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}
