"use client";

import Link from "next/link";
import { T } from "gt-next";
import { NavigationDropdown } from "./NavigationDropdown";

export const resourceLinks = [
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
  { href: "/changelog", label: "Changelog" },
  { href: "https://github.com/ugurkocde/IntuneGet", label: "GitHub" },
];
export function ResourcesDropdown() {
  return (
    <NavigationDropdown
      label={<T>Resources</T>}
      panelClassName="right-0 w-52 p-2"
    >
      {(close) => (
        <div className="space-y-0.5">
          {resourceLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={close}
              className="flex items-center rounded-lg px-3 py-2.5 text-sm text-text-secondary transition-colors duration-150 hover:bg-overlay/[0.04] hover:text-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
            >
              <T>{link.label}</T>
            </Link>
          ))}
        </div>
      )}
    </NavigationDropdown>
  );
}
