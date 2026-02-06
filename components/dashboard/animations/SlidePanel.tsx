'use client';

import { ReactNode, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { slidePanelRight, slidePanelLeft, modalOverlay } from '@/lib/animations';

interface SlidePanelProps {
  /** Whether the panel is open */
  isOpen: boolean;
  /** Callback when panel should close */
  onClose: () => void;
  /** Panel content */
  children: ReactNode;
  /** Panel title */
  title?: string;
  /** Panel description */
  description?: string;
  /** Panel width */
  width?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Slide direction */
  direction?: 'left' | 'right';
  /** Show overlay backdrop */
  showOverlay?: boolean;
  /** Close on overlay click */
  closeOnOverlayClick?: boolean;
  /** Close on escape key */
  closeOnEscape?: boolean;
  /** Show close button */
  showCloseButton?: boolean;
  /** Custom CSS classes for the panel */
  className?: string;
  /** Custom CSS classes for the header */
  headerClassName?: string;
  /** Custom CSS classes for the content */
  contentClassName?: string;
  /** Custom header content (replaces title/description) */
  header?: ReactNode;
  /** Footer content */
  footer?: ReactNode;
}

const widthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-full'
};

export function SlidePanel({
  isOpen,
  onClose,
  children,
  title,
  description,
  width = 'md',
  direction = 'right',
  showOverlay = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  className,
  headerClassName,
  contentClassName,
  header,
  footer
}: SlidePanelProps) {
  const prefersReducedMotion = useReducedMotion();

  // Handle escape key
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        onClose();
      }
    },
    [onClose, closeOnEscape]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when panel is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape]);

  const panelVariants = direction === 'right' ? slidePanelRight : slidePanelLeft;

  // Reduced motion variants
  const reducedMotionVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 }
  };

  const activeVariants = prefersReducedMotion ? reducedMotionVariants : panelVariants;

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <div className="fixed inset-0 z-50">
          {/* Overlay */}
          {showOverlay && (
            <motion.div
              variants={prefersReducedMotion ? reducedMotionVariants : modalOverlay}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={closeOnOverlayClick ? onClose : undefined}
              aria-hidden="true"
            />
          )}

          {/* Panel */}
          <motion.div
            variants={activeVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              'absolute top-0 h-full w-full bg-bg-surface border-black/10 shadow-2xl flex flex-col',
              direction === 'right' ? 'right-0 border-l' : 'left-0 border-r',
              widthClasses[width],
              className
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'slide-panel-title' : undefined}
            aria-describedby={description ? 'slide-panel-description' : undefined}
          >
            {/* Header */}
            {(title || description || header || showCloseButton) && (
              <div
                className={cn(
                  'flex items-start justify-between px-6 py-4 border-b border-black/10',
                  headerClassName
                )}
              >
                {header ?? (
                  <div className="flex-1">
                    {title && (
                      <h2
                        id="slide-panel-title"
                        className="text-lg font-semibold text-text-primary"
                      >
                        {title}
                      </h2>
                    )}
                    {description && (
                      <p
                        id="slide-panel-description"
                        className="mt-1 text-sm text-text-secondary"
                      >
                        {description}
                      </p>
                    )}
                  </div>
                )}

                {showCloseButton && (
                  <button
                    onClick={onClose}
                    className="p-2 -m-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-black/5 transition-colors"
                    aria-label="Close panel"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}

            {/* Content */}
            <div
              className={cn(
                'flex-1 overflow-y-auto px-6 py-4',
                contentClassName
              )}
            >
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div className="px-6 py-4 border-t border-black/10 bg-bg-surface/50">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// Bottom sheet variant
interface BottomSheetProps extends Omit<SlidePanelProps, 'direction' | 'width'> {
  /** Height of the sheet */
  height?: 'auto' | 'half' | 'full';
}

export function BottomSheet({
  isOpen,
  onClose,
  children,
  height = 'auto',
  showOverlay = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  className,
  header,
  footer,
  title,
  description
}: BottomSheetProps) {
  const prefersReducedMotion = useReducedMotion();

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        onClose();
      }
    },
    [onClose, closeOnEscape]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape]);

  const heightClasses = {
    auto: 'max-h-[90vh]',
    half: 'h-[50vh]',
    full: 'h-[90vh]'
  };

  const sheetVariants = {
    hidden: {
      y: '100%',
      opacity: prefersReducedMotion ? 0 : 0.5
    },
    visible: {
      y: 0,
      opacity: 1,
      transition: prefersReducedMotion
        ? { duration: 0.2 }
        : {
            type: 'spring' as const,
            damping: 30,
            stiffness: 300
          }
    },
    exit: {
      y: '100%',
      opacity: prefersReducedMotion ? 0 : 0.5,
      transition: prefersReducedMotion
        ? { duration: 0.2 }
        : {
            type: 'spring' as const,
            damping: 30,
            stiffness: 300
          }
    }
  };

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <div className="fixed inset-0 z-50">
          {showOverlay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={closeOnOverlayClick ? onClose : undefined}
            />
          )}

          <motion.div
            variants={sheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              'absolute bottom-0 left-0 right-0 bg-bg-surface border-t border-black/10 rounded-t-2xl flex flex-col',
              heightClasses[height],
              className
            )}
            role="dialog"
            aria-modal="true"
          >
            {/* Drag handle */}
            <div className="flex justify-center py-3">
              <div className="w-10 h-1 rounded-full bg-zinc-400" />
            </div>

            {/* Header */}
            {(title || description || header || showCloseButton) && (
              <div className="flex items-start justify-between px-6 pb-4 border-b border-black/10">
                {header ?? (
                  <div className="flex-1">
                    {title && (
                      <h2 className="text-lg font-semibold text-text-primary">
                        {title}
                      </h2>
                    )}
                    {description && (
                      <p className="mt-1 text-sm text-text-secondary">{description}</p>
                    )}
                  </div>
                )}
                {showCloseButton && (
                  <button
                    onClick={onClose}
                    className="p-2 -m-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-black/5 transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

            {/* Footer */}
            {footer && (
              <div className="px-6 py-4 border-t border-black/10">{footer}</div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
