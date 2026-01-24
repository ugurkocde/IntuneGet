"use client";

import Link from "next/link";
import { Package, Github, Twitter, Linkedin } from "lucide-react";
import { FadeIn } from "../animations/FadeIn";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative w-full py-12 md:py-16 border-t border-white/5">
      {/* Top glow line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/20 to-transparent" />

      <div className="container relative px-4 md:px-6 mx-auto max-w-7xl">
        <FadeIn>
          <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            {/* Logo and info */}
            <div className="flex flex-col items-center md:items-start gap-4">
              <Link
                href="#"
                className="flex items-center gap-2 group"
              >
                <div className="relative">
                  <Package className="h-6 w-6 text-accent-cyan transition-transform duration-300 group-hover:scale-110" />
                  <div className="absolute inset-0 bg-accent-cyan/30 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>
                <span className="text-xl font-semibold text-white">
                  IntuneGet
                </span>
              </Link>
              <p className="text-sm text-zinc-500 text-center md:text-left">
                {currentYear} | Made with care by Ugur Koc
                <br />
                Open-source project under MIT License
              </p>
            </div>

            {/* Navigation */}
            <nav className="flex flex-wrap items-center justify-center gap-6 md:gap-8">
              <Link
                href="#features"
                className="text-sm text-zinc-400 hover:text-accent-cyan transition-colors duration-200"
              >
                Features
              </Link>
              <Link
                href="#how-it-works"
                className="text-sm text-zinc-400 hover:text-accent-cyan transition-colors duration-200"
              >
                How It Works
              </Link>
              <Link
                href="https://ugurkoc.de/privacy-policy/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-zinc-400 hover:text-accent-cyan transition-colors duration-200"
              >
                Privacy
              </Link>
              <Link
                href="https://github.com/ugurkocde/IntuneGet"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-zinc-400 hover:text-accent-cyan transition-colors duration-200 flex items-center gap-1"
              >
                <Github className="h-4 w-4" />
                GitHub
              </Link>
            </nav>
          </div>
        </FadeIn>

        {/* Bottom section */}
        <FadeIn delay={0.1}>
          <div className="mt-8 pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-zinc-600">
            <p>
              Simplifying Intune app deployment for IT professionals worldwide.
            </p>
            <div className="flex items-center gap-4">
              <Link
                href="https://twitter.com/yourhandle"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-accent-cyan transition-colors"
                aria-label="Twitter"
              >
                <Twitter className="h-5 w-5" />
              </Link>
              <Link
                href="https://linkedin.com/in/yourhandle"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-accent-cyan transition-colors"
                aria-label="LinkedIn"
              >
                <Linkedin className="h-5 w-5" />
              </Link>
              <Link
                href="https://github.com/ugurkocde/IntuneGet"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-accent-cyan transition-colors"
                aria-label="GitHub"
              >
                <Github className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </FadeIn>
      </div>
    </footer>
  );
}
