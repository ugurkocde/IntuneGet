"use client";

import Image from "next/image";
import { T } from "gt-next";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Clock3,
  History,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { FadeIn } from "../animations/FadeIn";

const permissionChecks = [
  {
    label: "App management",
    scope: "DeviceManagementApps.ReadWrite.All",
  },
  {
    label: "Managed-device reporting",
    scope: "DeviceManagementManagedDevices.Read.All",
  },
  {
    label: "Enrollment status pages",
    scope: "DeviceManagementServiceConfig.ReadWrite.All",
  },
  {
    label: "Assignment filters",
    scope: "DeviceManagementConfiguration.Read.All",
  },
];

const updatePolicies = [
  {
    name: "Google Chrome",
    icon: "/icons/Google.Chrome/icon-64.png",
    policy: "Auto-update",
    policyClass:
      "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    status: "Monitoring",
    statusClass: "text-emerald-700 dark:text-emerald-300",
  },
  {
    name: "7-Zip",
    icon: "/icons/7zip.7zip/icon-64.png",
    policy: "Notify only",
    policyClass:
      "border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    status: "Update available",
    statusClass: "text-amber-700 dark:text-amber-300",
  },
  {
    name: "Visual Studio Code",
    icon: "/icons/Microsoft.VisualStudioCode/icon-64.png",
    policy: "Pin version",
    policyClass:
      "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    status: "Pinned",
    statusClass: "text-text-secondary",
  },
];

const deploymentStates = [
  {
    label: "Completed",
    icon: CheckCircle2,
    className: "text-emerald-700 dark:text-emerald-300",
  },
  { label: "In progress", icon: Clock3, className: "text-accent-cyan" },
  {
    label: "Needs attention",
    icon: AlertTriangle,
    className: "text-amber-700 dark:text-amber-300",
  },
];

const capabilityRail = [
  { label: "Flexible search", icon: Search },
  { label: "Exact catalog IDs", icon: Check },
  { label: "Update history", icon: History },
  { label: "Clear recovery paths", icon: ShieldCheck },
];

const cardClassName =
  "overflow-hidden rounded-2xl border border-overlay/10 bg-bg-elevated shadow-card";

export function CapabilitiesSection() {
  return (
    <section
      id="features"
      className="relative w-full scroll-mt-20 overflow-hidden bg-bg-surface py-20 md:scroll-mt-24 md:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,var(--accent-cyan)_0%,transparent_42%)] opacity-[0.035]"
      />

      <div className="container relative mx-auto max-w-7xl px-4 md:px-6">
        <div className="mx-auto max-w-4xl text-center">
          <FadeIn>
            <span className="mb-4 inline-block font-mono text-xs uppercase tracking-[0.18em] text-accent-cyan">
              <T id="features.badge">Capabilities</T>
            </span>
          </FadeIn>
          <FadeIn delay={0.08}>
            <h2 className="text-balance text-3xl font-bold tracking-tight text-text-primary md:text-4xl lg:text-5xl">
              <T>Less packaging work. More control.</T>
            </h2>
          </FadeIn>
          <FadeIn delay={0.16}>
            <p className="mx-auto mt-5 max-w-3xl text-pretty text-base leading-relaxed text-text-secondary md:text-lg">
              <T>
                The safeguards and automation you need before, during, and after
                every upload.
              </T>
            </p>
          </FadeIn>
        </div>

        <div className="mx-auto mt-12 grid max-w-6xl gap-5 lg:grid-cols-12">
          <FadeIn className="lg:col-span-5 lg:row-span-2" delay={0.2}>
            <article className={`${cardClassName} h-full`}>
              <div className="flex items-start gap-4 border-b border-overlay/10 p-5 md:p-6">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-cyan/10 text-accent-cyan">
                  <ShieldCheck className="h-6 w-6" aria-hidden="true" />
                </div>
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
                    <T>Before upload</T>
                  </span>
                  <h3 className="mt-1 text-xl font-semibold text-text-primary md:text-2xl">
                    <T>Deploy with confidence</T>
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    <T>
                      IntuneGet tests the Microsoft Graph access required for
                      your selected deployment before packaging begins.
                    </T>
                  </p>
                </div>
              </div>

              <div className="p-5 md:p-6">
                <p className="mb-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                  <T>Permission check preview</T>
                </p>
                <ul className="divide-y divide-overlay/10 rounded-xl border border-overlay/10">
                  {permissionChecks.map((permission) => (
                    <li
                      key={permission.scope}
                      className="flex items-start gap-3 px-4 py-3.5"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500">
                        <Check className="h-3 w-3" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-text-primary">
                          <T>{permission.label}</T>
                        </span>
                        <code
                          className="mt-0.5 block break-all text-[11px] text-text-muted"
                          translate="no"
                        >
                          {permission.scope}
                        </code>
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-3.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2
                    className="h-5 w-5 shrink-0"
                    aria-hidden="true"
                  />
                  <T>Required access is verified before deployment</T>
                </div>
              </div>
            </article>
          </FadeIn>

          <FadeIn className="lg:col-span-7" delay={0.26}>
            <article className={cardClassName}>
              <div className="flex items-start gap-4 border-b border-overlay/10 p-5 md:p-6">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-cyan/10 text-accent-cyan">
                  <RefreshCw className="h-6 w-6" aria-hidden="true" />
                </div>
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
                    <T>After upload</T>
                  </span>
                  <h3 className="mt-1 text-xl font-semibold text-text-primary md:text-2xl">
                    <T>Stay current automatically</T>
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    <T>
                      Choose auto-update, notify only, ignore, or pin version
                      for every deployed app.
                    </T>
                  </p>
                </div>
              </div>

              <div className="p-5 md:p-6">
                <div className="hidden grid-cols-[minmax(0,1fr)_auto_auto] gap-4 px-3 pb-2 text-[10px] font-medium uppercase tracking-wider text-text-muted sm:grid">
                  <span>
                    <T>Application</T>
                  </span>
                  <span>
                    <T>Policy</T>
                  </span>
                  <span className="text-right">
                    <T>Status</T>
                  </span>
                </div>
                <ul className="divide-y divide-overlay/10 rounded-xl border border-overlay/10">
                  {updatePolicies.map((app) => (
                    <li
                      key={app.name}
                      className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Image
                          src={app.icon}
                          alt=""
                          width={36}
                          height={36}
                          className="h-9 w-9 shrink-0 object-contain"
                        />
                        <span
                          className="truncate text-sm font-medium text-text-primary"
                          translate="no"
                        >
                          {app.name}
                        </span>
                      </div>
                      <span
                        className={`w-fit rounded-full border px-2.5 py-1 text-xs font-medium ${app.policyClass}`}
                      >
                        <T>{app.policy}</T>
                      </span>
                      <span
                        className={`text-sm font-medium sm:text-right ${app.statusClass}`}
                      >
                        <T>{app.status}</T>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-secondary">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck
                      className="h-3.5 w-3.5 text-accent-cyan"
                      aria-hidden="true"
                    />
                    <T>Circuit breakers</T>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3
                      className="h-3.5 w-3.5 text-accent-cyan"
                      aria-hidden="true"
                    />
                    <T>Rate limiting</T>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <History
                      className="h-3.5 w-3.5 text-accent-cyan"
                      aria-hidden="true"
                    />
                    <T>Full update history</T>
                  </span>
                </div>
              </div>
            </article>
          </FadeIn>

          <FadeIn className="lg:col-span-3" delay={0.32}>
            <article className={`${cardClassName} h-full p-5 md:p-6`}>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-cyan/10 text-accent-cyan">
                <Bell className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-text-primary">
                <T>Know when action is needed</T>
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                <T>
                  Send update and deployment alerts through email or webhooks.
                </T>
              </p>
              <ul
                className="mt-5 grid grid-cols-3 gap-2"
                aria-label="Notification channels"
              >
                {[
                  { label: "Email", icon: Mail },
                  { label: "Teams", icon: Webhook },
                  { label: "Slack", icon: Webhook },
                ].map(({ label, icon: Icon }) => (
                  <li
                    key={label}
                    className="flex min-w-0 flex-col items-center gap-2 rounded-xl border border-overlay/10 bg-bg-surface/60 px-2 py-3 text-center"
                  >
                    <Icon
                      className="h-5 w-5 text-accent-cyan"
                      aria-hidden="true"
                    />
                    <span
                      className="text-xs font-medium text-text-secondary"
                      translate="no"
                    >
                      {label}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          </FadeIn>

          <FadeIn className="lg:col-span-4" delay={0.38}>
            <article className={`${cardClassName} h-full p-5 md:p-6`}>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-cyan/10 text-accent-cyan">
                <History className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-text-primary">
                <T>See every outcome</T>
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                <T>Status, history, and recovery guidance stay in one place.</T>
              </p>
              <ul className="mt-5 divide-y divide-overlay/10 rounded-xl border border-overlay/10">
                {deploymentStates.map(({ label, icon: Icon, className }) => (
                  <li
                    key={label}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                  >
                    <span className="text-sm text-text-secondary">
                      <T>{label}</T>
                    </span>
                    <Icon
                      className={`h-4 w-4 ${className}`}
                      aria-hidden="true"
                    />
                  </li>
                ))}
              </ul>
            </article>
          </FadeIn>
        </div>

        <FadeIn delay={0.44}>
          <ul className="mx-auto mt-5 grid max-w-6xl divide-y divide-overlay/10 overflow-hidden rounded-2xl border border-overlay/10 bg-bg-elevated shadow-soft sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            {capabilityRail.map(({ label, icon: Icon }) => (
              <li
                key={label}
                className="flex items-center gap-3 px-5 py-4 text-sm font-medium text-text-secondary"
              >
                <Icon
                  className="h-4 w-4 shrink-0 text-accent-cyan"
                  aria-hidden="true"
                />
                <T>{label}</T>
              </li>
            ))}
          </ul>
        </FadeIn>
      </div>
    </section>
  );
}

export { CapabilitiesSection as FeaturesSection };
