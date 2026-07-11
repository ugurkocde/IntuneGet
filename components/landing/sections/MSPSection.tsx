"use client";

import Image from "next/image";
import Link from "next/link";
import { T } from "gt-next";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  PackageOpen,
  ScrollText,
  ShieldCheck,
  UploadCloud,
  Users,
  type LucideIcon,
} from "lucide-react";
import { FadeIn } from "../animations/FadeIn";
import { cn } from "@/lib/utils";

interface TenantStatus {
  name: string;
  status: string;
  icon: LucideIcon;
  statusClassName: string;
  iconClassName: string;
}

const tenants: TenantStatus[] = [
  {
    name: "Contoso",
    status: "Ready",
    icon: CheckCircle2,
    statusClassName: "text-emerald-700 dark:text-emerald-300",
    iconClassName: "text-emerald-600 dark:text-emerald-400",
  },
  {
    name: "Northwind",
    status: "Uploading",
    icon: UploadCloud,
    statusClassName: "text-blue-700 dark:text-blue-300",
    iconClassName: "text-blue-600 dark:text-blue-400",
  },
  {
    name: "Fabrikam",
    status: "Packaging",
    icon: PackageOpen,
    statusClassName: "text-amber-700 dark:text-amber-300",
    iconClassName: "text-amber-600 dark:text-amber-400",
  },
  {
    name: "Alpine",
    status: "Queued",
    icon: Clock3,
    statusClassName: "text-text-muted",
    iconClassName: "text-text-muted",
  },
];

const proofPoints = [
  { label: "Tenant isolation", icon: ShieldCheck },
  { label: "Role-based access", icon: Users },
  { label: "Complete audit trail", icon: ScrollText },
];

function TenantCard({
  tenant,
  position,
}: {
  tenant: TenantStatus;
  position: "top" | "bottom";
}) {
  const StatusIcon = tenant.icon;

  return (
    <article
      className={cn(
        "relative z-10 flex min-w-0 items-center gap-3 rounded-2xl border border-overlay/10 bg-bg-elevated p-3 shadow-card sm:p-4",
        position === "top"
          ? "after:absolute after:left-1/2 after:top-full after:h-6 after:border-l after:border-dashed after:border-accent-cyan/50 sm:after:h-8"
          : "before:absolute before:bottom-full before:left-1/2 before:h-6 before:border-l before:border-dashed before:border-accent-cyan/50 sm:before:h-8"
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-cyan/[0.08] text-accent-cyan ring-1 ring-inset ring-accent-cyan/10 sm:h-12 sm:w-12">
        <Building2 className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <h3
          className="truncate text-sm font-semibold text-text-primary sm:text-base"
          translate="no"
        >
          {tenant.name}
        </h3>
        <p
          className={cn(
            "mt-0.5 flex items-center gap-1.5 text-xs font-medium sm:text-sm",
            tenant.statusClassName
          )}
        >
          <StatusIcon
            className={cn("h-3.5 w-3.5 shrink-0", tenant.iconClassName)}
            aria-hidden="true"
          />
          <T>{tenant.status}</T>
        </p>
      </div>
    </article>
  );
}

export function MSPSection() {
  return (
    <section
      id="msp"
      className="relative w-full scroll-mt-20 overflow-hidden bg-bg-deepest py-20 md:scroll-mt-24 md:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_48%,var(--accent-cyan)_0%,transparent_38%)] opacity-[0.035]"
      />

      <div className="container relative mx-auto max-w-7xl px-4 md:px-6">
        <div className="grid items-center gap-14 lg:grid-cols-[0.76fr_1.24fr] lg:gap-12 xl:gap-16">
          <div className="max-w-xl">
            <FadeIn>
              <span className="inline-flex rounded-full bg-[#071b3a] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-sm dark:bg-accent-cyan/15 dark:text-accent-cyan">
                <T id="msp.badge">For MSPs</T>
              </span>
            </FadeIn>

            <FadeIn delay={0.08}>
              <h2 className="mt-7 text-balance text-4xl font-bold tracking-tight text-text-primary sm:text-5xl lg:text-[3.25rem] lg:leading-[1.05] xl:text-[3.5rem]">
                <T id="msp.heading">
                  One workspace. Every client tenant.
                </T>
              </h2>
            </FadeIn>

            <FadeIn delay={0.16}>
              <p className="mt-6 max-w-lg text-pretty text-lg leading-relaxed text-text-secondary">
                <T id="msp.subheading">
                  Manage app deployments across customer tenants without
                  switching accounts.
                </T>
              </p>
            </FadeIn>

            <FadeIn delay={0.22}>
              <ul className="mt-8 divide-y divide-overlay/10 border-y border-overlay/10">
                {proofPoints.map(({ label, icon: Icon }) => (
                  <li key={label} className="flex items-center gap-4 py-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-cyan/[0.08] text-accent-cyan ring-1 ring-inset ring-accent-cyan/10">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="font-semibold text-text-primary">
                      <T>{label}</T>
                    </span>
                  </li>
                ))}
              </ul>
            </FadeIn>

            <FadeIn delay={0.28}>
              <Link
                href="/docs/msp"
                className="group mt-8 inline-flex items-center gap-3 rounded-xl border border-accent-cyan/40 bg-bg-elevated px-5 py-3 text-sm font-semibold text-text-primary shadow-sm transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-accent-cyan hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-deepest"
              >
                <T id="msp.cta">Explore MSP features</T>
                <ArrowRight
                  className="h-4 w-4 text-accent-cyan transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </FadeIn>
          </div>

          <FadeIn delay={0.18}>
            <div className="relative mx-auto w-full max-w-3xl py-2 sm:py-5">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-[76%] w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-accent-cyan/15"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-[54%] w-[52%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-accent-cyan/10"
              />

              <div className="relative grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-10 sm:gap-y-8 lg:gap-x-12">
                <TenantCard tenant={tenants[0]} position="top" />
                <TenantCard tenant={tenants[1]} position="top" />

                <div className="relative z-20 col-span-2 overflow-hidden rounded-2xl border border-overlay/10 bg-bg-elevated shadow-soft-lg sm:rounded-3xl">
                  <div className="flex items-center justify-between bg-[#071b3a] px-4 py-3.5 text-white sm:px-6 sm:py-4">
                    <div className="flex items-baseline gap-3">
                      <span className="text-lg font-semibold tracking-tight">
                        Intune<span className="text-cyan-400">Get</span>
                      </span>
                      <span className="hidden text-xs text-slate-300 sm:inline">
                        <T>MSP workspace</T>
                      </span>
                    </div>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20">
                      <Users className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </div>

                  <div className="p-4 sm:p-6">
                    <div>
                      <h3 className="text-lg font-semibold text-text-primary sm:text-xl">
                        <T>Review batch deployment</T>
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-text-muted sm:text-sm">
                        <T>
                          Verify the selected app and customer tenants before
                          deployment.
                        </T>
                      </p>
                    </div>

                    <div className="mt-5 grid gap-5 sm:grid-cols-[0.8fr_1.2fr] sm:items-center sm:gap-6">
                      <div className="flex items-center gap-4 sm:block">
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-overlay/10 bg-bg-surface p-2.5 sm:h-24 sm:w-24">
                          <Image
                            src="/icons/7zip.7zip/icon-128.png"
                            alt="7-Zip"
                            width={96}
                            height={96}
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <div className="min-w-0 sm:mt-3">
                          <p
                            className="text-lg font-semibold text-text-primary"
                            translate="no"
                          >
                            7-Zip
                          </p>
                          <code
                            className="mt-0.5 block text-xs text-text-muted"
                            translate="no"
                          >
                            7zip.7zip
                          </code>
                          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                            <Users
                              className="h-3.5 w-3.5 text-accent-cyan"
                              aria-hidden="true"
                            />
                            <T>4 selected tenants</T>
                          </p>
                        </div>
                      </div>

                      <ul className="divide-y divide-overlay/10 rounded-xl border border-overlay/10">
                        {tenants.map((tenant) => {
                          const StatusIcon = tenant.icon;

                          return (
                            <li
                              key={tenant.name}
                              className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                            >
                              <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-text-primary">
                                <Building2
                                  className="h-4 w-4 shrink-0 text-accent-cyan"
                                  aria-hidden="true"
                                />
                                <span className="truncate" translate="no">
                                  {tenant.name}
                                </span>
                              </span>
                              <span
                                className={cn(
                                  "flex shrink-0 items-center gap-1.5 text-xs font-medium",
                                  tenant.statusClassName
                                )}
                              >
                                <StatusIcon
                                  className={cn(
                                    "h-3.5 w-3.5",
                                    tenant.iconClassName
                                  )}
                                  aria-hidden="true"
                                />
                                <T>{tenant.status}</T>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    <div className="mt-5 flex justify-end">
                      <span className="inline-flex items-center gap-2 rounded-lg bg-[#071b3a] px-4 py-2.5 text-xs font-semibold text-white shadow-sm sm:text-sm">
                        <T>Review deployment</T>
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                </div>

                <TenantCard tenant={tenants[2]} position="bottom" />
                <TenantCard tenant={tenants[3]} position="bottom" />
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
