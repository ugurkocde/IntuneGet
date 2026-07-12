"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { Menu, X, Star, Book } from "lucide-react";
import { Github } from "@/components/icons/brand-icons";
import { cn } from "@/lib/utils";
import { DocsDropdown } from "./DocsDropdown";
import { ResourcesDropdown } from "./ResourcesDropdown";
import { T, useGT, useLocale } from "gt-next";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { useSharedGitHubStats } from "@/components/providers/LandingStatsProvider";
import { useMicrosoftAuth } from "@/hooks/useMicrosoftAuth";
import { useProfileStore } from "@/stores/profile-store";

const primaryNavLinks = [
  { href: "/apps", label: "Apps" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/security", label: "Security" },
];

const secondaryNavLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
  { href: "/changelog", label: "Changelog" },
];

export function Header() {
  const t = useGT();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const shouldReduceMotion = useReducedMotion();

  const { isAuthenticated, user, getAccessToken } = useMicrosoftAuth();
  const { profileImage, fetchProfileImage, hasFetched } = useProfileStore();
  const initials = user?.name?.charAt(0) || user?.email?.charAt(0) || "U";

  // Star count is fetched client-side and hidden until loaded, so the
  // server-rendered markup never contains a number that could mismatch.
  const localeTag = useLocale() || undefined;
  const { stars, isLoading: starsLoading } = useSharedGitHubStats();
  const starsDisplay = new Intl.NumberFormat(localeTag, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(stars);

  const { scrollY } = useScroll();
  const headerOpacity = useTransform(scrollY, [0, 100], [0, 1]);

  useEffect(() => {
    const handleScroll = () => {
      setHasScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isMenuOpen]);

  useEffect(() => {
    if (isAuthenticated && !hasFetched) {
      getAccessToken().then((token) => {
        if (token) fetchProfileImage(token);
      });
    }
  }, [isAuthenticated, hasFetched, getAccessToken, fetchProfileImage]);

  const UserAvatar = ({ size = "sm" }: { size?: "sm" | "md" }) => (
    <div className="relative flex-shrink-0">
      <div className="absolute -inset-0.5 bg-gradient-to-br from-accent-cyan to-accent-cyan-dim rounded-full opacity-75 group-hover:opacity-100 transition-opacity" />
      <div className={cn(
        "relative rounded-full bg-overlay/[0.06] flex items-center justify-center overflow-hidden",
        size === "sm" ? "w-8 h-8" : "w-9 h-9"
      )}>
        {profileImage ? (
          <img
            src={profileImage}
            alt="Profile"
            width={32}
            height={32}
            className="w-full h-full object-cover"
            onError={() => useProfileStore.getState().setProfileImage(null)}
          />
        ) : (
          <span className="text-sm font-semibold text-text-secondary">{initials}</span>
        )}
      </div>
    </div>
  );

  return (
    <motion.header
      className="fixed top-0 left-0 right-0 z-50 pointer-events-none"
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.5,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
    >
      <div
        className={cn(
          "pointer-events-auto relative mx-auto transition-all duration-500 ease-spring",
          hasScrolled
            ? "mt-3 w-fit max-w-[calc(100%-2rem)] rounded-2xl border border-overlay/[0.06] shadow-soft-md"
            : "max-w-full"
        )}
      >
        {/* Animated background */}
        <motion.div
          className={cn(
            "absolute inset-0 backdrop-blur-xl transition-[background-color,border-radius] duration-500",
            hasScrolled
              ? "bg-bg-elevated/75 rounded-2xl"
              : "bg-bg-deepest/80"
          )}
          style={{
            opacity: shouldReduceMotion ? (hasScrolled ? 1 : 0) : headerOpacity,
          }}
        />

        <div className={cn(
          "relative mx-auto px-4 md:px-6 transition-all duration-500",
          hasScrolled ? "" : "max-w-7xl"
        )}>
          <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group z-10">
            <motion.div
              className="relative"
              whileHover={
                shouldReduceMotion
                  ? {}
                  : {
                      scale: 1.1,
                      transition: { duration: 0.2 },
                    }
              }
            >
              <Image
                src="/favicon.svg"
                alt="IntuneGet Logo"
                width={28}
                height={28}
                className="h-7 w-7"
              />
            </motion.div>
            <span className="text-xl font-semibold text-text-primary">IntuneGet</span>
          </Link>

          {/* Desktop navigation */}
          <nav className={cn(
            "ml-6 hidden min-w-0 items-center whitespace-nowrap transition-all duration-500 lg:flex",
            hasScrolled ? "gap-4" : "gap-5"
          )}>
            {primaryNavLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="group relative rounded-sm text-sm font-medium text-text-secondary transition-colors duration-200 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-4 focus-visible:ring-offset-bg-deepest"
              >
                <T>{link.label}</T>
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-accent-cyan transition-all duration-300 group-hover:w-full" />
              </Link>
            ))}
            <DocsDropdown />
            <ResourcesDropdown />
            <a
              href="https://github.com/ugurkocde/IntuneGet"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("View IntuneGet on GitHub")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-overlay/10 px-2.5 py-1.5 text-sm font-medium text-text-secondary transition-colors duration-200 hover:border-overlay/15 hover:bg-overlay/[0.04] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
            >
              <Github className="h-4 w-4" />
              <span className="flex items-center gap-1 text-xs text-text-muted min-w-[2.25rem]">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                {!starsLoading && (
                  <>
                    <span className="tabular-nums">{starsDisplay}</span>
                    <span className="sr-only">{t("GitHub stars")}</span>
                  </>
                )}
              </span>
            </a>
            <LocaleSwitcher />
            <ThemeToggle />
            {isAuthenticated ? (
              <Link
                href="/dashboard"
                aria-label={t("Go to dashboard")}
                className="group"
              >
                <UserAvatar size="sm" />
              </Link>
            ) : (
              <Link
                href="/auth/signin"
                className={cn(
                  "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-4 py-2",
                  "text-sm font-medium text-white bg-accent-cyan",
                  "transition-all duration-200",
                  "hover:bg-accent-cyan-dim shadow-soft hover:shadow-soft-md",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-deepest"
                )}
              >
                <T id="nav.get-started">Get Started</T>
              </Link>
            )}
          </nav>

          {/* Mobile menu button */}
          <button
            ref={menuButtonRef}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="relative z-10 flex min-h-[44px] min-w-[44px] items-center justify-center p-2 text-text-secondary transition-colors hover:text-text-primary lg:hidden"
            aria-label={isMenuOpen ? t("Close menu") : t("Open menu")}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-menu"
          >
            {isMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            className={cn(
              "pointer-events-auto mx-auto mt-2 transition-[max-width] duration-500 lg:hidden",
              hasScrolled
                ? "max-w-5xl px-0"
                : "max-w-full px-0"
            )}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.2,
            }}
          >
            <nav
              id="mobile-menu"
              className={cn(
                "mx-4 flex flex-col gap-1 rounded-2xl border border-overlay/[0.06] bg-bg-elevated/90 px-4 py-4 shadow-soft-lg backdrop-blur-xl"
              )}
            >
              <span className="px-1 text-xs font-semibold uppercase tracking-wider text-text-muted"><T>Explore</T></span>
              {primaryNavLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMenuOpen(false)}
                  className="py-2.5 text-base font-medium text-text-secondary transition-colors hover:text-accent-cyan"
                >
                  <T>{link.label}</T>
                </Link>
              ))}
              <Link
                href="/docs"
                onClick={() => setIsMenuOpen(false)}
                className="inline-flex items-center gap-2 py-2.5 text-base font-medium text-text-secondary transition-colors hover:text-accent-cyan"
              >
                <Book className="h-5 w-5" />
                <span><T id="nav.documentation">Documentation</T></span>
              </Link>
              <div className="my-2 border-t border-overlay/[0.06]" />
              <span className="px-1 text-xs font-semibold uppercase tracking-wider text-text-muted"><T>Resources</T></span>
              {secondaryNavLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMenuOpen(false)}
                  className="py-2 text-base font-medium text-text-secondary transition-colors hover:text-accent-cyan"
                >
                  <T>{link.label}</T>
                </Link>
              ))}
              <a
                href="https://github.com/ugurkocde/IntuneGet"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsMenuOpen(false)}
                className="inline-flex items-center gap-2 py-2.5 text-base font-medium text-text-secondary transition-colors hover:text-accent-cyan"
              >
                <Github className="h-5 w-5" />
                <span><T id="nav.github">GitHub</T></span>
              </a>
              <div className="flex items-center gap-2">
                <LocaleSwitcher />
                <ThemeToggle />
              </div>
              {isAuthenticated ? (
                <Link
                  href="/dashboard"
                  onClick={() => setIsMenuOpen(false)}
                  className="group inline-flex items-center gap-3 px-4 py-3 rounded-lg mt-2 bg-text-primary hover:bg-text-primary/90 transition-all duration-200"
                >
                  <UserAvatar size="md" />
                  <span className="text-sm font-medium text-bg-elevated"><T id="nav.dashboard">Dashboard</T></span>
                </Link>
              ) : (
                <Link
                  href="/auth/signin"
                  onClick={() => setIsMenuOpen(false)}
                  className={cn(
                    "inline-flex items-center justify-center px-4 py-3 rounded-lg mt-2",
                    "text-sm font-medium text-white bg-accent-cyan",
                    "transition-all duration-200",
                    "hover:bg-accent-cyan-dim shadow-soft hover:shadow-soft-md"
                  )}
                >
                  <T id="nav.get-started">Get Started</T>
                </Link>
              )}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
