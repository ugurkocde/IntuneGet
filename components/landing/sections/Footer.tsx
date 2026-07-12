"use client";

import Image from "next/image";
import Link from "next/link";
import { T, Var } from "gt-next";
import {
  Apple,
  ArrowRight,
  BookOpen,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Server,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { GithubMark, Linkedin } from "@/components/icons/brand-icons";
import { FadeIn } from "../animations/FadeIn";
import { StaggerContainer, StaggerItem } from "../animations/StaggerContainer";

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

const socialLinks = [
  {
    icon: Linkedin,
    href: "https://www.linkedin.com/in/ugurkocde/",
    label: "LinkedIn",
  },
  {
    icon: GithubMark,
    href: "https://github.com/ugurkocde/IntuneGet",
    label: "GitHub",
  },
];

const footerGroups: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: "Deploy",
    links: [
      { label: "App catalog", href: "/apps" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "Get started", href: "/#get-started" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Security", href: "/security" },
      { label: "Blog", href: "/blog" },
    ],
  },
  {
    title: "Project",
    links: [
      {
        label: "GitHub",
        href: "https://github.com/ugurkocde/IntuneGet",
        external: true,
      },
      { label: "Changelog", href: "/changelog" },
      { label: "About", href: "/about" },
    ],
  },
];

const utilityLinks: Array<FooterLink & { icon: LucideIcon }> = [
  {
    label: "Deployment guide",
    href: "/blog/deploy-winget-apps-to-intune",
    icon: BookOpen,
  },
  {
    label: "Self-hosting guide",
    href: "/docs/docker",
    icon: Server,
  },
  {
    label: "Open a GitHub issue",
    href: "https://github.com/ugurkocde/IntuneGet/issues",
    icon: CircleHelp,
    external: true,
  },
];

const ecosystemLinks = [
  {
    label: "IntuneBrew",
    href: "https://intunebrew.com",
    icon: Apple,
  },
  {
    label: "TenuVault",
    href: "https://www.tenuvault.com/",
    icon: ShieldCheck,
  },
];

function FooterNavLink({ link }: { link: FooterLink }) {
  const className =
    "group inline-flex items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white";
  const content = (
    <>
      <T>{link.label}</T>
      {link.external && (
        <ExternalLink
          className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-70"
          aria-hidden="true"
        />
      )}
    </>
  );

  if (link.external || link.href.startsWith("mailto:")) {
    return (
      <a
        href={link.href}
        target={link.external ? "_blank" : undefined}
        rel={link.external ? "noopener noreferrer" : undefined}
        className={className}
      >
        {content}
      </a>
    );
  }

  return (
    <Link href={link.href} className={className}>
      {content}
    </Link>
  );
}

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative w-full overflow-hidden bg-[#061a37] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_30%,rgba(0,174,239,0.09),transparent_30%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-accent-cyan/25" />

      <div className="container relative mx-auto max-w-7xl px-4 pb-12 pt-14 md:px-6 md:pb-14 md:pt-16">
        <StaggerContainer
          className="grid gap-12 lg:grid-cols-[1.35fr_1.65fr] lg:gap-20"
          staggerDelay={0.08}
          delayStart={0.1}
        >
          <StaggerItem>
            <Link
              href="/"
              className="group inline-flex items-center gap-3"
              aria-label="IntuneGet home"
            >
              <Image
                src="/favicon.svg"
                alt=""
                width={52}
                height={52}
                className="h-12 w-12 transition-transform duration-300 group-hover:-translate-y-0.5"
              />
              <span className="text-3xl font-bold tracking-tight text-white">
                Intune<span className="text-accent-cyan">Get</span>
              </span>
            </Link>
            <p className="mt-4 max-w-sm text-base leading-relaxed text-white/60">
              <T id="footer.brand-description">
                Winget apps, ready for Microsoft Intune.
              </T>
            </p>

            <div className="mt-7 flex items-center gap-5">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/70 transition-colors hover:text-white"
                  aria-label={social.label}
                >
                  <social.icon className="h-7 w-7" />
                </a>
              ))}
            </div>
          </StaggerItem>

          <div className="hidden grid-cols-3 gap-10 lg:grid">
            {footerGroups.map((group) => (
              <StaggerItem key={group.title}>
                <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-white">
                  <T>{group.title}</T>
                </h3>
                <ul className="mt-5 space-y-3.5">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <FooterNavLink link={link} />
                    </li>
                  ))}
                </ul>
              </StaggerItem>
            ))}
          </div>
        </StaggerContainer>

        <div className="mt-10 divide-y divide-white/10 border-y border-white/10 lg:hidden">
          {footerGroups.map((group) => (
            <details
              key={group.title}
              className="group py-1"
              open={group.title === "Deploy"}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between py-4 text-sm font-bold uppercase tracking-[0.14em] text-white marker:hidden">
                <T>{group.title}</T>
                <ChevronDown
                  className="h-4 w-4 text-white/50 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <ul className="grid gap-3 pb-5 sm:grid-cols-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <FooterNavLink link={link} />
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </div>

      <div className="relative border-y border-white/10 bg-white/[0.025]">
        <div className="container mx-auto grid max-w-7xl divide-y divide-white/10 px-4 md:grid-cols-3 md:divide-x md:divide-y-0 md:px-6">
          {utilityLinks.map((link) => {
            const Icon = link.icon;
            const className =
              "group flex items-center gap-4 py-5 text-sm font-semibold text-white transition-colors hover:text-accent-cyan md:justify-center md:px-6 md:py-6";
            const UtilityArrow = link.external ? ExternalLink : ArrowRight;
            const content = (
              <>
                <Icon
                  className="h-6 w-6 text-accent-cyan transition-transform group-hover:-translate-y-0.5"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                <T>{link.label}</T>
                <UtilityArrow
                  className="ml-auto h-3.5 w-3.5 opacity-40 md:ml-0"
                  aria-hidden="true"
                />
              </>
            );

            return link.external ? (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={className}
              >
                {content}
              </a>
            ) : (
              <Link key={link.label} href={link.href} className={className}>
                {content}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="container relative mx-auto max-w-7xl px-4 py-7 md:px-6">
        <FadeIn delay={0.2}>
          <div className="flex flex-col gap-6 text-sm text-white/55 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <p>
                <T id="footer.copyright">
                  &copy; <Var>{currentYear}</Var>{" "}
                  <a
                    href="https://ugurlabs.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors hover:text-white"
                  >
                    UgurLabs
                  </a>
                </T>
              </p>
              <Link
                href="/privacy"
                className="transition-colors hover:text-white"
              >
                <T>Privacy</T>
              </Link>
              <Link
                href="/terms"
                className="transition-colors hover:text-white"
              >
                <T>Terms</T>
              </Link>
              <a
                href="mailto:hello@ugurlabs.com"
                className="transition-colors hover:text-white"
              >
                <T>Contact</T>
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-5">
              {ecosystemLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 font-medium text-white/70 transition-colors hover:text-white"
                >
                  <link.icon
                    className="h-4 w-4 text-status-success"
                    aria-hidden="true"
                  />
                  {link.label}
                  <ExternalLink
                    className="h-3 w-3 opacity-40 transition-opacity group-hover:opacity-80"
                    aria-hidden="true"
                  />
                </a>
              ))}
            </div>
          </div>
        </FadeIn>
      </div>
    </footer>
  );
}
