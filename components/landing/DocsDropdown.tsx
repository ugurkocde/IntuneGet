"use client";

import Link from "next/link";
import {
  Rocket,
  Cloud,
  Database,
  Container,
  ClipboardList,
  RefreshCw,
  Building2,
  FileText,
  ArrowRight,
} from "lucide-react";
import { T } from "gt-next";

import { NavigationDropdown } from "./NavigationDropdown";

const setupLinks = [
  { href: "/docs/getting-started", label: "Getting Started", icon: Rocket },
  { href: "/docs/azure-setup", label: "Entra ID Setup", icon: Cloud },
  { href: "/docs/database-setup", label: "Database Setup", icon: Database },
  { href: "/docs/docker", label: "Docker", icon: Container },
];

const featureLinks = [
  {
    href: "/docs/sccm-migration",
    label: "SCCM Migration",
    icon: ClipboardList,
  },
  {
    href: "/docs/updates-policies",
    label: "Updates & Policies",
    icon: RefreshCw,
  },
  { href: "/docs/msp", label: "MSP Features", icon: Building2 },
  { href: "/docs/api-reference", label: "API Reference", icon: FileText },
];

export function DocsDropdown() {
  return (
    <NavigationDropdown
      label={<T id="docs.trigger">Docs</T>}
      panelClassName="left-1/2 -translate-x-1/2 w-[420px] p-4"
    >
      {(close) => (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted px-2 mb-2">
                <T id="docs.heading.setup">Setup</T>
              </span>
              <div className="space-y-0.5">
                {setupLinks.map((link) => {
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={close}
                      className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-text-secondary hover:text-accent-cyan hover:bg-overlay/[0.04] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                    >
                      <Icon
                        aria-hidden="true"
                        className="h-4 w-4 flex-shrink-0 text-text-muted"
                      />
                      <span>
                        <T>{link.label}</T>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted px-2 mb-2">
                <T id="docs.heading.features">Features</T>
              </span>
              <div className="space-y-0.5">
                {featureLinks.map((link) => {
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={close}
                      className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-text-secondary hover:text-accent-cyan hover:bg-overlay/[0.04] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                    >
                      <Icon
                        aria-hidden="true"
                        className="h-4 w-4 flex-shrink-0 text-text-muted"
                      />
                      <span>
                        <T>{link.label}</T>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-overlay/[0.06]">
            <Link
              href="/docs"
              onClick={close}
              className="flex items-center justify-between px-2 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-accent-cyan hover:bg-overlay/[0.04] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
            >
              <span>
                <T id="docs.view-all">View all documentation</T>
              </span>
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </>
      )}
    </NavigationDropdown>
  );
}
