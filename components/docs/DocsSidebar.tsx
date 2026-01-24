"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Book,
  Rocket,
  Cloud,
  Database,
  Github,
  Container,
  HelpCircle,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  title: string;
  href: string;
  icon: typeof Book;
  description?: string;
}

const navItems: NavItem[] = [
  {
    title: "Overview",
    href: "/docs",
    icon: Book,
    description: "Introduction to self-hosting",
  },
  {
    title: "Getting Started",
    href: "/docs/getting-started",
    icon: Rocket,
    description: "Complete setup walkthrough",
  },
  {
    title: "Azure AD Setup",
    href: "/docs/azure-setup",
    icon: Cloud,
    description: "Microsoft Entra ID configuration",
  },
  {
    title: "Database Setup",
    href: "/docs/database-setup",
    icon: Database,
    description: "Supabase configuration",
  },
  {
    title: "GitHub Setup",
    href: "/docs/github-setup",
    icon: Github,
    description: "GitHub Actions pipeline",
  },
  {
    title: "Docker",
    href: "/docs/docker",
    icon: Container,
    description: "Docker deployment",
  },
  {
    title: "Troubleshooting",
    href: "/docs/troubleshooting",
    icon: HelpCircle,
    description: "Common issues & FAQ",
  },
];

interface DocsSidebarProps {
  className?: string;
}

export function DocsSidebar({ className }: DocsSidebarProps) {
  const pathname = usePathname();

  return (
    <nav className={cn("space-y-1", className)}>
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
              isActive
                ? "bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20"
                : "text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent"
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4 flex-shrink-0 transition-colors",
                isActive ? "text-accent-cyan" : "text-zinc-500 group-hover:text-zinc-300"
              )}
            />
            <span className="flex-1 truncate">{item.title}</span>
            {isActive && (
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-accent-cyan" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileDocsSidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 w-72 bg-bg-deepest border-r border-white/5 p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <span className="text-lg font-semibold text-white">Documentation</span>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white transition-colors"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-accent-cyan/10 text-accent-cyan"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 flex-shrink-0",
                    isActive ? "text-accent-cyan" : "text-zinc-500"
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{item.title}</div>
                  {item.description && (
                    <div className="text-xs text-zinc-500 truncate">
                      {item.description}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export { navItems };
