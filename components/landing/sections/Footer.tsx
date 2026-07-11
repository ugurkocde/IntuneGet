"use client";

import Link from "next/link";
import Image from "next/image";
import { ExternalLink, Apple, ShieldCheck, LucideIcon } from "lucide-react";
import { Github, Linkedin } from "@/components/icons/brand-icons";
import { T, Var } from "gt-next";
import { FadeIn } from "../animations/FadeIn";
import { StaggerContainer, StaggerItem } from "../animations/StaggerContainer";
import { GradientOrb } from "../ui/GradientOrb";

const socialLinks = [
  { icon: Linkedin, href: "https://www.linkedin.com/in/ugurkocde/", label: "LinkedIn" },
  { icon: Github, href: "https://github.com/ugurkocde/IntuneGet", label: "GitHub" },
];

const footerLinks = {
  product: [
    { label: "Features", href: "/#features" },
    { label: "How It Works", href: "/#how-it-works" },
    { label: "Pricing", href: "/pricing" },
    { label: "Documentation", href: "/docs" },
  ],
  resources: [
    { label: "Blog", href: "/blog" },
    { label: "Winget to Intune Guide", href: "/blog/deploy-winget-apps-to-intune" },
    { label: "SCCM Migration Guide", href: "/blog/sccm-to-intune-migration-winget" },
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
    { label: "IntuneBrew", description: "macOS App Deployment", href: "https://intunebrew.com", external: true, icon: Apple as LucideIcon },
    { label: "TenuVault", description: "Intune Backup & Restore", href: "https://www.tenuvault.com/", external: true, icon: ShieldCheck as LucideIcon },
  ],
};

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative w-full bg-bg-elevated overflow-hidden">
      {/* Gradient line at top */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/20 to-transparent" />

      {/* Background orb */}
      <GradientOrb
        color="cyan"
        size="lg"
        intensity="low"
        animate={false}
        className="absolute -bottom-48 -right-24"
      />

      {/* Main footer content */}
      <div className="container relative px-4 md:px-6 mx-auto max-w-7xl py-16 md:py-20">
        <StaggerContainer staggerDelay={0.08} delayStart={0.1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-7 gap-8 md:gap-10">
            {/* Brand column */}
            <StaggerItem className="col-span-1 sm:col-span-2">
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
                <span className="text-xl font-semibold text-text-primary">IntuneGet</span>
              </Link>
              <p className="text-sm text-text-muted mb-6 max-w-xs">
                <T id="footer.brand-description">Deploy any app from Winget to Intune in minutes. Free and open source under AGPL-3.0.</T>
              </p>

              {/* Social links */}
              <div className="flex items-center gap-3">
                {socialLinks.map((social) => (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 flex items-center justify-center rounded-lg bg-bg-surface text-text-muted hover:bg-overlay/[0.06] hover:text-text-primary transition-colors"
                    aria-label={social.label}
                  >
                    <social.icon className="w-4 h-4" />
                  </a>
                ))}
              </div>
            </StaggerItem>

            {/* Product links */}
            <StaggerItem>
              <h3 className="text-sm font-semibold text-text-primary mb-4"><T id="footer.heading.product">Product</T></h3>
              <ul className="space-y-3">
                {footerLinks.product.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="relative text-sm text-text-muted hover:text-text-primary transition-colors group"
                    >
                      <T>{link.label}</T>
                      <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-accent-cyan transition-all duration-300 group-hover:w-full" />
                    </Link>
                  </li>
                ))}
              </ul>
            </StaggerItem>

            {/* Resources links */}
            <StaggerItem>
              <h3 className="text-sm font-semibold text-text-primary mb-4"><T id="footer.heading.resources">Resources</T></h3>
              <ul className="space-y-3">
                {footerLinks.resources.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="relative text-sm text-text-muted hover:text-text-primary transition-colors group"
                    >
                      <T>{link.label}</T>
                      <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-accent-cyan transition-all duration-300 group-hover:w-full" />
                    </Link>
                  </li>
                ))}
              </ul>
            </StaggerItem>

            {/* Company links */}
            <StaggerItem>
              <h3 className="text-sm font-semibold text-text-primary mb-4"><T id="footer.heading.company">Company</T></h3>
              <ul className="space-y-3">
                {footerLinks.company.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("mailto:") ? (
                      <a
                        href={link.href}
                        className="relative text-sm text-text-muted hover:text-text-primary transition-colors inline-flex items-center gap-1 group"
                      >
                        <T>{link.label}</T>
                        <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-accent-cyan transition-all duration-300 group-hover:w-full" />
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="relative text-sm text-text-muted hover:text-text-primary transition-colors inline-flex items-center gap-1 group"
                      >
                        <T>{link.label}</T>
                        <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-accent-cyan transition-all duration-300 group-hover:w-full" />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </StaggerItem>

            {/* Legal links */}
            <StaggerItem>
              <h3 className="text-sm font-semibold text-text-primary mb-4"><T id="footer.heading.legal">Legal</T></h3>
              <ul className="space-y-3">
                {footerLinks.legal.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="relative text-sm text-text-muted hover:text-text-primary transition-colors group"
                    >
                      <T>{link.label}</T>
                      <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-accent-cyan transition-all duration-300 group-hover:w-full" />
                    </Link>
                  </li>
                ))}
              </ul>
            </StaggerItem>

            {/* Ecosystem links */}
            <StaggerItem>
              <h3 className="text-sm font-semibold text-text-primary mb-4"><T id="footer.heading.ecosystem">Ecosystem</T></h3>
              <ul className="space-y-3">
                {footerLinks.ecosystem.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
                      className="group"
                    >
                      <span className="text-sm text-text-muted hover:text-accent-cyan transition-colors inline-flex items-center gap-1.5">
                        <link.icon className="w-4 h-4" />
                        {link.label}
                        {link.external && <ExternalLink className="w-3 h-3" />}
                      </span>
                      <span className="block text-xs text-text-muted mt-0.5 ml-[22px]">
                        <T>{link.description}</T>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </StaggerItem>
          </div>
        </StaggerContainer>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-overlay/[0.06]">
        <div className="container relative px-4 md:px-6 mx-auto max-w-7xl py-6">
          <FadeIn delay={0.4}>
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-text-muted">
              <p>
                <T id="footer.copyright">
                  &copy; <Var>{currentYear}</Var>{" "}
                  <a
                    href="https://ugurlabs.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative text-accent-cyan hover:text-accent-cyan-dim transition-colors group"
                  >
                    UgurLabs
                    <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-accent-cyan transition-all duration-300 group-hover:w-full" />
                  </a>
                  . Made with care by{" "}
                  <a
                    href="https://www.linkedin.com/in/ugurkocde/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative text-accent-cyan hover:text-accent-cyan-dim transition-colors group"
                  >
                    Ugur Koc
                    <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-accent-cyan transition-all duration-300 group-hover:w-full" />
                  </a>
                </T>
              </p>
              <p className="text-center md:text-right">
                <T id="footer.opensource">
                  Open source. Star us on{" "}
                  <a
                    href="https://github.com/ugurkocde/IntuneGet"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative text-accent-cyan hover:text-accent-cyan-dim transition-colors group"
                  >
                    GitHub
                    <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-accent-cyan transition-all duration-300 group-hover:w-full" />
                  </a>
                </T>
              </p>
            </div>
          </FadeIn>
        </div>
      </div>
    </footer>
  );
}
