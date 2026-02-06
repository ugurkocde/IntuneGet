"use client";

import Link from "next/link";
import Image from "next/image";
import { Github, Linkedin, ExternalLink, Apple } from "lucide-react";
import { FadeIn } from "../animations/FadeIn";

const footerLinks = {
  product: [
    { label: "Features", href: "/#features" },
    { label: "How It Works", href: "/#how-it-works" },
    { label: "Documentation", href: "/docs" },
  ],
  company: [
    { label: "About", href: "/about" },
    { label: "Changelog", href: "/changelog" },
    { label: "Contact", href: "mailto:hello@ugurlabs.com" },
  ],
  legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
  ],
  ecosystem: [
    { label: "IntuneBrew", description: "macOS App Deployment", href: "https://intunebrew.com", external: true },
    { label: "TenuVault", description: "Intune Backup & Restore", href: "https://www.tenuvault.com/", external: true },
  ],
};

const socialLinks = [
  { icon: Linkedin, href: "https://www.linkedin.com/in/ugurkocde/", label: "LinkedIn" },
  { icon: Github, href: "https://github.com/ugurkocde/IntuneGet", label: "GitHub" },
];

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative w-full bg-white border-t border-stone-200/60">
      {/* Main footer content */}
      <div className="container relative px-4 md:px-6 mx-auto max-w-7xl py-12 md:py-16">
        <FadeIn>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-8 md:gap-10">
            {/* Brand column */}
            <div className="col-span-2">
              <Link href="/" className="flex items-center gap-2 group mb-4">
                <div className="relative">
                  <Image
                    src="/favicon.svg"
                    alt="IntuneGet Logo"
                    width={28}
                    height={28}
                    className="h-7 w-7"
                  />
                </div>
                <span className="text-xl font-semibold text-stone-900">IntuneGet</span>
              </Link>
              <p className="text-sm text-stone-500 mb-6 max-w-xs">
                Deploy any app from Winget to Intune in minutes. Free, open source, and trusted by IT teams worldwide.
              </p>

              {/* Social links */}
              <div className="flex items-center gap-3">
                {socialLinks.map((social) => (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 flex items-center justify-center rounded-lg bg-stone-50 text-stone-500 hover:bg-stone-100 hover:text-stone-900 transition-colors"
                    aria-label={social.label}
                  >
                    <social.icon className="w-4 h-4" />
                  </a>
                ))}
              </div>
            </div>

            {/* Product links */}
            <div>
              <h4 className="text-sm font-semibold text-stone-900 mb-4">Product</h4>
              <ul className="space-y-3">
                {footerLinks.product.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-stone-500 hover:text-stone-900 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company links */}
            <div>
              <h4 className="text-sm font-semibold text-stone-900 mb-4">Company</h4>
              <ul className="space-y-3">
                {footerLinks.company.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("mailto:") ? (
                      <a
                        href={link.href}
                        className="text-sm text-stone-500 hover:text-stone-900 transition-colors inline-flex items-center gap-1"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-stone-500 hover:text-stone-900 transition-colors inline-flex items-center gap-1"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal links */}
            <div>
              <h4 className="text-sm font-semibold text-stone-900 mb-4">Legal</h4>
              <ul className="space-y-3">
                {footerLinks.legal.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-stone-500 hover:text-stone-900 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Ecosystem links */}
            <div>
              <h4 className="text-sm font-semibold text-stone-900 mb-4">Ecosystem</h4>
              <ul className="space-y-3">
                {footerLinks.ecosystem.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
                      className="group"
                    >
                      <span className="text-sm text-stone-500 hover:text-accent-cyan transition-colors inline-flex items-center gap-1.5">
                        <Apple className="w-4 h-4" />
                        {link.label}
                        {link.external && <ExternalLink className="w-3 h-3" />}
                      </span>
                      <span className="block text-xs text-stone-400 mt-0.5 ml-5.5">
                        {link.description}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </FadeIn>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-stone-200/60">
        <div className="container relative px-4 md:px-6 mx-auto max-w-7xl py-6">
          <FadeIn delay={0.1}>
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-stone-500">
              <p>
                {currentYear}{" "}
                <a
                  href="https://ugurlabs.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:text-accent-cyan-dim transition-colors"
                >
                  UgurLabs
                </a>
                . Made with care by{" "}
                <a
                  href="https://www.linkedin.com/in/ugurkocde/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:text-accent-cyan-dim transition-colors"
                >
                  Ugur Koc
                </a>
              </p>
              <p className="text-center md:text-right">
                Open source. Star us on{" "}
                <a
                  href="https://github.com/ugurkocde/IntuneGet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:text-accent-cyan-dim transition-colors"
                >
                  GitHub
                </a>
              </p>
            </div>
          </FadeIn>
        </div>
      </div>
    </footer>
  );
}
