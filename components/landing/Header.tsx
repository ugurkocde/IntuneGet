"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How It Works" },
];

export function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const { scrollY } = useScroll();
  const headerOpacity = useTransform(scrollY, [0, 100], [0, 1]);
  const headerBlur = useTransform(scrollY, [0, 100], [0, 12]);

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
          ? "border-b border-white/5"
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
          <Link href="#" className="flex items-center gap-2 group z-10">
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
              <div className="absolute inset-0 bg-accent-cyan/30 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </motion.div>
            <span className="text-xl font-semibold text-white">IntuneGet</span>
          </Link>

          {/* Desktop navigation */}
          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="relative text-sm font-medium text-zinc-400 hover:text-white transition-colors duration-200 group"
              >
                {link.label}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-accent-cyan transition-all duration-300 group-hover:w-full" />
              </Link>
            ))}
            <Link
              href="#get-started"
              className={cn(
                "inline-flex items-center justify-center px-4 py-2 rounded-lg",
                "text-sm font-medium text-bg-deepest bg-accent-cyan",
                "transition-all duration-200",
                "hover:bg-accent-cyan-bright hover:shadow-glow-cyan"
              )}
            >
              Join Waitlist
            </Link>
          </nav>

          {/* Mobile menu button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden relative z-10 p-2 text-zinc-400 hover:text-white transition-colors"
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
          "md:hidden fixed inset-x-0 top-16 bg-bg-deepest/95 backdrop-blur-xl border-b border-white/5",
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
              className="text-lg font-medium text-zinc-300 hover:text-accent-cyan transition-colors py-2"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="#get-started"
            onClick={() => setIsMenuOpen(false)}
            className={cn(
              "inline-flex items-center justify-center px-4 py-3 rounded-lg mt-2",
              "text-sm font-medium text-bg-deepest bg-accent-cyan",
              "transition-all duration-200",
              "hover:bg-accent-cyan-bright"
            )}
          >
            Join Waitlist
          </Link>
        </nav>
      </motion.div>
    </motion.header>
  );
}
