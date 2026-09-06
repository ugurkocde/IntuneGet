"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { T } from "gt-next";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

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
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-4">
        <T>Resources</T>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={20}
        className="w-52 rounded-xl p-2"
      >
        {resourceLinks.map((link) => (
          <DropdownMenuItem
            key={link.href}
            asChild
            className="rounded-lg px-3 py-2.5"
          >
            <Link href={link.href}>
              <T>{link.label}</T>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
