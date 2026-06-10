"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { Menu, X, Star, Apple, ExternalLink, Book } from "lucide-react";
import { Github } from "@/components/icons/brand-icons";
import { cn } from "@/lib/utils";
import { DocsDropdown } from "./DocsDropdown";
import { T } from "gt-next";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { useMicrosoftAuth } from "@/hooks/useMicrosoftAuth";
import { useProfileStore } from "@/stores/profile-store";

const navLinks = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/blog", label: "Blog" },
  { href: "/changelog", label: "Changelog" },
];

export function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const { isAuthenticated, user, getAccessToken } = useMicrosoftAuth();
  const { profileImage, fetchProfileImage, hasFetched } = useProfileStore();
  const initials = user?.name?.charAt(0) || user?.email?.charAt(0) || "U";

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
    if (isAuthenticated && !hasFetched) {
      getAccessToken().then((token) => {
        if (token) fetchProfileImage(token);
      });
    }
  }, [isAuthenticated, hasFetched, getAccessToken, fetchProfileImage]);

  const UserAvatar = ({ size = "sm" }: { size?: "sm" | "md" }) => (
    <div className="relative flex-shrink-0">
      <div className="absolute -inset-0.5 bg-gradient-to-br from-accent-cyan to-accent-violet rounded-full opacity-75 group-hover:opacity-100 transition-opacity" />
      <div className={cn(
        "relative rounded-full bg-overlay/[0.06] flex items-center justify-center overflow-hidden",
        size === "sm" ? "w-8 h-8" : "w-9 h-9"
      )}>
        {profileImage ? (
          <img
            src={profileImage}
            alt="Profile"
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
            "hidden md:flex items-center ml-8 transition-all duration-500",
            hasScrolled ? "gap-5" : "gap-8"
          )}>
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="relative text-sm font-medium text-text-secondary hover:text-text-primary transition-colors duration-200 group"
              >
                <T>{link.label}</T>
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-accent-cyan transition-all duration-300 group-hover:w-full" />
              </Link>
            ))}
            <DocsDropdown />
            <a
              href="https://intunebrew.com"
              target="_blank"
              rel="noopener noreferrer"
              className="relative text-sm font-medium text-text-secondary hover:text-text-primary transition-colors duration-200 group inline-flex items-center gap-1.5"
            >
              <Apple className="h-4 w-4" />
              <span><T id="nav.macos">macOS</T></span>
              <ExternalLink className="h-3 w-3 opacity-50" />
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-accent-cyan transition-all duration-300 group-hover:w-full" />
            </a>
            <a
              href="https://github.com/ugurkocde/IntuneGet"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors duration-200 px-3 py-1.5 rounded-lg border border-overlay/10 hover:border-overlay/15 hover:bg-overlay/[0.04]"
            >
              <Github className="h-4 w-4" />
              <span><T id="nav.github">GitHub</T></span>
              <span className="flex items-center gap-1 text-xs text-text-muted">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              </span>
            </a>
            <LocaleSwitcher />
            {isAuthenticated ? (
              <Link
                href="/dashboard"
                aria-label="Go to dashboard"
                className="group"
              >
                <UserAvatar size="sm" />
              </Link>
            ) : (
              <Link
                href="/auth/signin"
                className={cn(
                  "inline-flex items-center justify-center px-4 py-2 rounded-lg",
                  "text-sm font-medium text-bg-elevated bg-text-primary",
                  "transition-all duration-200",
                  "hover:bg-text-primary/90 shadow-soft hover:shadow-soft-md"
                )}
              >
                <T id="nav.get-started">Get Started</T>
              </Link>
            )}
          </nav>

          {/* Mobile menu button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden relative z-10 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Toggle menu"
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
      <motion.div
        className={cn(
          "md:hidden pointer-events-auto mx-auto mt-2 transition-[max-width] duration-500",
          hasScrolled
            ? "max-w-5xl px-0"
            : "max-w-full px-0",
          !isMenuOpen && "pointer-events-none"
        )}
        initial={{ opacity: 0, y: -20 }}
        animate={{
          opacity: isMenuOpen ? 1 : 0,
          y: isMenuOpen ? 0 : -20,
        }}
        transition={{
          duration: shouldReduceMotion ? 0 : 0.2,
        }}
      >
        <nav className={cn(
          "mx-4 px-4 py-6 flex flex-col gap-4 bg-bg-elevated/90 backdrop-blur-xl border border-overlay/[0.06] rounded-2xl shadow-soft-lg"
        )}>
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setIsMenuOpen(false)}
              className="text-lg font-medium text-text-secondary hover:text-accent-cyan transition-colors py-3"
            >
              <T>{link.label}</T>
            </Link>
          ))}
          <Link
            href="/docs"
            onClick={() => setIsMenuOpen(false)}
            className="inline-flex items-center gap-2 text-lg font-medium text-text-secondary hover:text-accent-cyan transition-colors py-3"
          >
            <Book className="h-5 w-5" />
            <span><T id="nav.documentation">Documentation</T></span>
          </Link>
          <a
            href="https://intunebrew.com"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setIsMenuOpen(false)}
            className="inline-flex items-center gap-2 text-lg font-medium text-text-secondary hover:text-accent-cyan transition-colors py-3"
          >
            <Apple className="h-5 w-5" />
            <span><T id="nav.macos-apps">macOS Apps</T></span>
            <ExternalLink className="h-4 w-4 opacity-50" />
          </a>
          <a
            href="https://github.com/ugurkocde/IntuneGet"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setIsMenuOpen(false)}
            className="inline-flex items-center gap-2 text-lg font-medium text-text-secondary hover:text-accent-cyan transition-colors py-3"
          >
            <Github className="h-5 w-5" />
            <span><T id="nav.github">GitHub</T></span>
          </a>
          <LocaleSwitcher />
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
                "text-sm font-medium text-bg-elevated bg-text-primary",
                "transition-all duration-200",
                "hover:bg-text-primary/90"
              )}
            >
              <T id="nav.get-started">Get Started</T>
            </Link>
          )}
        </nav>
      </motion.div>
    </motion.header>
  );
}
