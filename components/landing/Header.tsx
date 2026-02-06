"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { Menu, X, Github, Star, Apple, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How It Works" },
];

export function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const { scrollY } = useScroll();
  const headerOpacity = useTransform(scrollY, [0, 100], [0, 1]);

  useEffect(() => {
    const handleScroll = () => {
      setHasScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <motion.header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-colors duration-300",
        hasScrolled
          ? "border-b border-stone-200/60"
          : "border-b border-transparent"
      )}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.5,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
    >
      {/* Animated background */}
      <motion.div
        className="absolute inset-0 bg-bg-deepest/80 backdrop-blur-xl"
        style={{
          opacity: shouldReduceMotion ? (hasScrolled ? 1 : 0) : headerOpacity,
        }}
      />

      <div className="container relative mx-auto max-w-7xl px-4 md:px-6">
        <div className="flex h-16 items-center justify-between">
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
            <span className="text-xl font-semibold text-stone-900">IntuneGet</span>
          </Link>

          {/* Desktop navigation */}
          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="relative text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors duration-200 group"
              >
                {link.label}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-accent-cyan transition-all duration-300 group-hover:w-full" />
              </Link>
            ))}
            <a
              href="https://intunebrew.com"
              target="_blank"
              rel="noopener noreferrer"
              className="relative text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors duration-200 group inline-flex items-center gap-1.5"
            >
              <Apple className="h-4 w-4" />
              <span>macOS</span>
              <ExternalLink className="h-3 w-3 opacity-50" />
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-accent-cyan transition-all duration-300 group-hover:w-full" />
            </a>
            <a
              href="https://github.com/ugurkocde/IntuneGet"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors duration-200 px-3 py-1.5 rounded-lg border border-stone-200 hover:border-stone-300 hover:bg-stone-50"
            >
              <Github className="h-4 w-4" />
              <span>GitHub</span>
              <span className="flex items-center gap-1 text-xs text-stone-500">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              </span>
            </a>
            <Link
              href="/auth/signin"
              className={cn(
                "inline-flex items-center justify-center px-4 py-2 rounded-lg",
                "text-sm font-medium text-white bg-stone-900",
                "transition-all duration-200",
                "hover:bg-stone-800 shadow-soft hover:shadow-soft-md"
              )}
            >
              Get Started
            </Link>
          </nav>

          {/* Mobile menu button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden relative z-10 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-stone-600 hover:text-stone-900 transition-colors"
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

      {/* Mobile menu */}
      <motion.div
        className={cn(
          "md:hidden fixed inset-x-0 top-16 bg-bg-deepest/95 backdrop-blur-xl border-b border-stone-200/60",
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
        <nav className="container mx-auto px-4 py-6 flex flex-col gap-4">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setIsMenuOpen(false)}
              className="text-lg font-medium text-stone-700 hover:text-accent-cyan transition-colors py-3"
            >
              {link.label}
            </Link>
          ))}
          <a
            href="https://intunebrew.com"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setIsMenuOpen(false)}
            className="inline-flex items-center gap-2 text-lg font-medium text-stone-700 hover:text-accent-cyan transition-colors py-3"
          >
            <Apple className="h-5 w-5" />
            <span>macOS Apps</span>
            <ExternalLink className="h-4 w-4 opacity-50" />
          </a>
          <a
            href="https://github.com/ugurkocde/IntuneGet"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setIsMenuOpen(false)}
            className="inline-flex items-center gap-2 text-lg font-medium text-stone-700 hover:text-accent-cyan transition-colors py-3"
          >
            <Github className="h-5 w-5" />
            <span>GitHub</span>
          </a>
          <Link
            href="/auth/signin"
            onClick={() => setIsMenuOpen(false)}
            className={cn(
              "inline-flex items-center justify-center px-4 py-3 rounded-lg mt-2",
              "text-sm font-medium text-white bg-stone-900",
              "transition-all duration-200",
              "hover:bg-stone-800"
            )}
          >
            Get Started
          </Link>
        </nav>
      </motion.div>
    </motion.header>
  );
}
