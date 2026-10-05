"use client";

import Link from "next/link";
import { T } from "gt-next";
import { openChangelog } from "@/lib/product-changelog";
import { NavigationDropdown } from "./NavigationDropdown";

// Entries without an href open the updates panel behind the header bell.
export const resourceLinks: Array<{ href?: string; label: string }> = [
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
  { label: "Changelog" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "https://github.com/ugurkocde/IntuneGet", label: "GitHub" },
];
const itemClassName =
  "flex items-center rounded-lg px-3 py-2.5 text-sm text-text-secondary transition-colors duration-150 hover:bg-overlay/[0.04] hover:text-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan";

export function ResourcesDropdown() {
  return (
    <NavigationDropdown
      label={<T>Resources</T>}
      panelClassName="right-0 w-52 p-2"
    >
      {(close) => (
        <div className="space-y-0.5">
          {resourceLinks.map((link) =>
            link.href ? (
              <Link
                key={link.label}
                href={link.href}
                onClick={close}
                className={itemClassName}
              >
                <T>{link.label}</T>
              </Link>
            ) : (
              <button
                key={link.label}
                type="button"
                onClick={() => {
                  close();
                  openChangelog();
                }}
                className={`w-full text-left ${itemClassName}`}
              >
                <T>{link.label}</T>
              </button>
            ),
          )}
        </div>
      )}
    </NavigationDropdown>
  );
}
