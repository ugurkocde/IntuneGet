"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { T, useGT } from "gt-next";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { useAuthHint } from "@/hooks/useAuthHint";
import { ChangelogBell } from "@/components/changelog/ChangelogBell";
import { DocsDropdown } from "./DocsDropdown";
import { ResourcesDropdown, resourceLinks } from "./ResourcesDropdown";
import { LocaleSwitcher } from "./LocaleSwitcher";

const AuthedAvatar = dynamic(
  () => import("./AuthedAvatar").then((m) => m.AuthedAvatar),
  {
    ssr: false,
    loading: () => <div className="h-8 w-8 rounded-full bg-overlay/[0.06]" />,
  },
);
const primaryLinks = [
  { href: "/apps", label: "App Catalog" },
  { href: "/apps/releases", label: "Release History" },
  { href: "/qa", label: "Live Packaging" },
];
const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2";

export function Header() {
  const t = useGT();
  const pathname = usePathname();
  const authenticated = useAuthHint();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  const active = (href: string) =>
    href === "/apps"
      ? pathname.startsWith("/apps") && !pathname.startsWith("/apps/releases")
      : pathname === href || pathname.startsWith(`${href}/`);
  const account = (mobile = false) => (
    <Link
      href={authenticated ? "/dashboard" : "/auth/signin"}
      onClick={() => setOpen(false)}
      aria-label={authenticated ? t("Go to dashboard") : undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-3 rounded-lg text-sm font-medium",
        focus,
        mobile
          ? "min-h-11 w-full bg-accent-cyan px-4 py-3 text-white"
          : authenticated
            ? "p-1"
            : "bg-accent-cyan px-4 py-2.5 text-white hover:bg-accent-cyan-dim",
      )}
    >
      {authenticated ? (
        <>
          <AuthedAvatar size="sm" />
          {mobile && <T>Dashboard</T>}
        </>
      ) : (
        <T id="nav.get-started">Get Started</T>
      )}
    </Link>
  );
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-overlay/[0.08] bg-bg-deepest/95 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 md:px-6">
        <Link
          href="/"
          className={cn("flex shrink-0 items-center gap-2 rounded-sm", focus)}
        >
          <Image
            src="/favicon.svg"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7"
          />
          <span className="text-xl font-semibold text-text-primary">
            IntuneGet
          </span>
        </Link>
        <nav
          aria-label={t("Main navigation")}
          className="ml-4 hidden items-center gap-6 whitespace-nowrap xl:flex"
        >
          {primaryLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active(link.href) ? "page" : undefined}
              className={cn(
                "relative inline-flex h-16 items-center border-b-2 text-sm font-medium transition-colors",
                focus,
                active(link.href)
                  ? "border-accent-cyan text-accent-cyan"
                  : "border-transparent text-text-secondary hover:text-text-primary",
              )}
            >
              <T>{link.label}</T>
            </Link>
          ))}
          <DocsDropdown />
          <ResourcesDropdown />
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="hidden xl:block">
            <LocaleSwitcher />
          </div>
          <ChangelogBell onOpen={() => setOpen(false)} />
          <div className="ml-2 hidden xl:block">{account()}</div>
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                aria-label={t("Open menu")}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary xl:hidden",
                  focus,
                )}
              >
                <Menu className="h-6 w-6" />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/30" />
              <Dialog.Content
                aria-describedby={undefined}
                className="fixed inset-0 z-[61] flex flex-col overflow-y-auto bg-bg-deepest px-6 pb-8 pt-4"
              >
                <div className="mb-8 flex items-center justify-between">
                  <Dialog.Title className="text-xl font-semibold text-text-primary">
                    IntuneGet
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label={t("Close menu")}
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary",
                        focus,
                      )}
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </Dialog.Close>
                </div>
                <nav aria-label={t("Mobile navigation")}>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    <T>Explore</T>
                  </p>
                  {[
                    ...primaryLinks,
                    { href: "/docs", label: "Documentation" },
                  ].map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setOpen(false)}
                      aria-current={active(link.href) ? "page" : undefined}
                      className={cn(
                        "block rounded-lg px-3 py-3 text-xl font-medium",
                        focus,
                        active(link.href)
                          ? "bg-accent-cyan/10 text-accent-cyan"
                          : "text-text-primary hover:bg-overlay/5",
                      )}
                    >
                      <T>{link.label}</T>
                    </Link>
                  ))}
                  <div className="my-6 border-t border-overlay/10" />
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    <T>Resources</T>
                  </p>
                  <div className="grid grid-cols-2 gap-x-4">
                    {resourceLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "rounded-lg py-3 text-sm font-medium text-text-secondary hover:text-accent-cyan",
                          focus,
                        )}
                      >
                        <T>{link.label}</T>
                      </Link>
                    ))}
                  </div>
                </nav>
                <div className="mt-auto space-y-5 pt-8">
                  <LocaleSwitcher />
                  {account(true)}
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}
