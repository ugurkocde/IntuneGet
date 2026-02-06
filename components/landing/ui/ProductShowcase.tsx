"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CheckCircle, Upload, Search, BarChart3, Clock } from "lucide-react";
import { useState } from "react";

interface ProductShowcaseProps {
  className?: string;
  compact?: boolean;
}

const apps = [
  { name: "Google Chrome", icon: "/icons/Google.Chrome/icon-64.png", status: "deployed", alt: "Google Chrome deployment to Microsoft Intune via IntuneGet" },
  { name: "Microsoft Teams", icon: "/icons/Microsoft.Teams/icon-64.png", status: "deployed", alt: "Microsoft Teams deployment to Intune using IntuneGet" },
  { name: "VS Code", icon: "/icons/Microsoft.VisualStudioCode/icon-64.png", status: "deployed", alt: "Visual Studio Code deployment to Intune with IntuneGet" },
  { name: "Slack", icon: "/icons/SlackTechnologies.Slack/icon-64.png", status: "pending", alt: "Slack app being packaged for Intune deployment" },
  { name: "Zoom", icon: "/icons/Zoom.Zoom/icon-64.png", status: "deployed", alt: "Zoom deployment to Microsoft Intune via IntuneGet" },
  { name: "7-Zip", icon: "/icons/7zip.7zip/icon-64.png", status: "ready", alt: "7-Zip ready for Intune deployment with IntuneGet" },
  { name: "Firefox", icon: "/icons/Mozilla.Firefox/icon-64.png", status: "ready", alt: "Mozilla Firefox ready for Intune deployment" },
  { name: "VLC Player", icon: "/icons/VideoLAN.VLC/icon-64.png", status: "ready", alt: "VLC Player ready for Intune deployment" },
];

export function ProductShowcase({ className = "", compact = false }: ProductShowcaseProps) {
  const shouldReduceMotion = useReducedMotion();
  const [showDropdown, setShowDropdown] = useState(false);

  const displayApps = compact ? apps.slice(0, 4) : apps;

  return (
    <div className={cn(
      "relative w-full mx-auto",
      compact ? "max-w-4xl" : "max-w-5xl",
      className
    )}>
      {/* Main product screenshot mockup */}
      <motion.div
        className="relative bg-white rounded-xl shadow-soft-xl border border-stone-200/60 overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: shouldReduceMotion ? 0 : 0.4,
          delay: 0.1,
          ease: [0.25, 0.46, 0.45, 0.94],
        }}
      >
        {/* Browser chrome */}
        <div className={cn(
          "flex items-center gap-2 bg-stone-50 border-b border-stone-200",
          compact ? "px-3 py-2" : "px-4 py-3"
        )}>
          <div className="flex gap-1.5">
            <div className={cn("rounded-full bg-stone-300", compact ? "w-2.5 h-2.5" : "w-3 h-3")} />
            <div className={cn("rounded-full bg-stone-300", compact ? "w-2.5 h-2.5" : "w-3 h-3")} />
            <div className={cn("rounded-full bg-stone-300", compact ? "w-2.5 h-2.5" : "w-3 h-3")} />
          </div>
          <div className="flex-1 mx-4">
            <div className={cn(
              "bg-white border border-stone-200 rounded-lg text-stone-500 max-w-md mx-auto",
              compact ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm"
            )}>
              intuneget.com/dashboard
            </div>
          </div>
        </div>

        {/* App content mockup */}
        <div className={cn(
          "bg-stone-50/50",
          compact ? "p-3 md:p-4" : "p-4 md:p-6"
        )}>
          {/* Search bar with dropdown */}
          <div className={cn(
            "relative flex items-center gap-2",
            compact ? "mb-3" : "mb-4 md:mb-6"
          )}>
            <motion.div
              className="flex-1 relative"
              onHoverStart={() => !shouldReduceMotion && setShowDropdown(true)}
              onHoverEnd={() => setShowDropdown(false)}
            >
              <div className={cn(
                "flex items-center gap-2 bg-white border border-stone-200 rounded-lg shadow-soft hover:border-accent-cyan/40 transition-colors cursor-text",
                compact ? "px-3 py-2" : "px-4 py-2.5 md:py-3"
              )}>
                <Search className={cn("text-stone-400", compact ? "w-4 h-4" : "w-5 h-5")} />
                <span className={cn("text-stone-500", compact ? "text-xs" : "text-sm md:text-base")}>
                  Search 10,000+ apps...
                </span>
              </div>

              {/* Search results dropdown - hidden in compact */}
              {!compact && (
                <motion.div
                  className="absolute top-full left-0 right-0 mt-2 bg-white border border-stone-200 rounded-xl shadow-soft-lg overflow-hidden z-10"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: showDropdown ? 1 : 0, y: showDropdown ? 0 : -10 }}
                  transition={{ duration: 0.2 }}
                  style={{ pointerEvents: showDropdown ? "auto" : "none" }}
                >
                  <div className="px-4 py-2 bg-stone-50 border-b border-stone-100">
                    <span className="text-xs font-medium text-stone-500">
                      <span className="text-accent-cyan font-semibold">10,847</span> apps found
                    </span>
                  </div>
                  <div className="py-2">
                    {["Google Chrome", "Microsoft Edge", "Mozilla Firefox", "Brave Browser"].map((app, i) => (
                      <div key={i} className="px-4 py-2 hover:bg-stone-50 cursor-pointer text-sm text-stone-700 flex items-center gap-2">
                        <div className="w-5 h-5 bg-stone-100 rounded" />
                        {app}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </motion.div>
            <button className={cn(
              "bg-accent-cyan text-white font-medium rounded-lg hover:bg-accent-cyan-dim transition-colors",
              compact ? "px-3 py-2 text-xs" : "px-4 md:px-5 py-2.5 md:py-3 text-sm md:text-base"
            )}>
              Search
            </button>
          </div>

          {/* Stats bar */}
          <motion.div
            className={cn(
              "flex items-center gap-3 px-1",
              compact ? "mb-3" : "mb-4 md:mb-6"
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.4 }}
          >
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className={cn("text-stone-500", compact ? "text-[10px]" : "text-xs")}>
                <span className="font-semibold text-stone-700">4</span> Deployed
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className={cn("text-stone-500", compact ? "text-[10px]" : "text-xs")}>
                <span className="font-semibold text-stone-700">1</span> Pending
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-stone-300" />
              <span className={cn("text-stone-500", compact ? "text-[10px]" : "text-xs")}>
                <span className="font-semibold text-stone-700">3</span> Ready
              </span>
            </div>
          </motion.div>

          {/* App grid */}
          <div className={cn(
            "grid",
            compact ? "grid-cols-2 sm:grid-cols-4 gap-2" : "grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4"
          )}>
            {displayApps.map((app, index) => (
              <motion.div
                key={app.name}
                className={cn(
                  "bg-white border border-stone-200 rounded-lg flex flex-col items-center hover:border-accent-cyan/40 hover:shadow-soft-md transition-all cursor-pointer group",
                  compact ? "p-2 gap-1.5" : "p-3 md:p-4 gap-2 md:gap-3"
                )}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: shouldReduceMotion ? 0 : 0.3,
                  delay: shouldReduceMotion ? 0 : 0.15 + index * 0.04,
                }}
              >
                <div className={cn(
                  "bg-stone-100 rounded-lg flex items-center justify-center group-hover:scale-105 transition-transform",
                  compact ? "w-8 h-8" : "w-10 h-10 md:w-12 md:h-12"
                )}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={app.icon}
                    alt={app.alt}
                    className={cn("object-contain", compact ? "w-5 h-5" : "w-7 h-7 md:w-8 md:h-8")}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <span className={cn(
                  "font-medium text-stone-700 text-center line-clamp-1",
                  compact ? "text-[10px]" : "text-xs md:text-sm"
                )}>{app.name}</span>
                {app.status === "deployed" && (
                  <span className={cn(
                    "flex items-center gap-1 text-emerald-600",
                    compact ? "text-[9px]" : "text-xs"
                  )}>
                    <CheckCircle className={cn(compact ? "w-2.5 h-2.5" : "w-3 h-3")} />
                    Deployed
                  </span>
                )}
                {app.status === "pending" && (
                  <span className={cn(
                    "flex items-center gap-1 text-amber-600",
                    compact ? "text-[9px]" : "text-xs"
                  )}>
                    <Clock className={cn(compact ? "w-2.5 h-2.5" : "w-3 h-3")} />
                    Pending
                  </span>
                )}
                {app.status === "ready" && (
                  <span className={cn("text-stone-400", compact ? "text-[9px]" : "text-xs")}>Ready</span>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Floating cards - hidden in compact mode */}
      {!compact && (
        <>
          {/* Floating upload progress card */}
          <motion.div
            className="absolute -right-4 md:right-8 top-16 md:top-24 bg-white rounded-xl shadow-soft-lg border border-stone-200 p-3 md:p-4 w-48 md:w-56 hidden sm:block"
            initial={{ opacity: 0, x: 30, y: 20 }}
            animate={{
              opacity: 1,
              x: 0,
              y: shouldReduceMotion ? 0 : [0, -8, 0],
            }}
            transition={{
              opacity: { duration: shouldReduceMotion ? 0 : 0.4, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
              x: { duration: shouldReduceMotion ? 0 : 0.4, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
              y: shouldReduceMotion
                ? { duration: 0 }
                : { duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.4 },
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 md:w-10 md:h-10 bg-accent-cyan/10 rounded-lg flex items-center justify-center">
                <Upload className="w-4 h-4 md:w-5 md:h-5 text-accent-cyan" />
              </div>
              <div>
                <p className="text-sm font-medium text-stone-700">Uploading</p>
                <p className="text-xs text-stone-400">Slack</p>
              </div>
            </div>
            <div className="relative h-2 bg-stone-100 rounded-full overflow-hidden">
              <motion.div
                className="absolute inset-y-0 left-0 bg-accent-cyan rounded-full"
                initial={{ width: "0%" }}
                animate={{ width: "68%" }}
                transition={{
                  duration: shouldReduceMotion ? 0 : 1.5,
                  delay: 0.6,
                  ease: "easeOut",
                }}
              />
            </div>
            <p className="text-xs text-stone-500 mt-2 text-right">68%</p>
          </motion.div>

          {/* Floating stats card */}
          <motion.div
            className="absolute -left-4 md:left-8 bottom-4 md:bottom-16 bg-white rounded-xl shadow-soft-lg border border-stone-200 p-3 md:p-4 w-44 md:w-48 hidden sm:block"
            initial={{ opacity: 0, x: -30, y: -20 }}
            animate={{
              opacity: 1,
              x: 0,
              y: shouldReduceMotion ? 0 : [0, -6, 0],
            }}
            transition={{
              opacity: { duration: shouldReduceMotion ? 0 : 0.4, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
              x: { duration: shouldReduceMotion ? 0 : 0.4, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
              y: shouldReduceMotion
                ? { duration: 0 }
                : { duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.5 },
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 md:w-10 md:h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-4 h-4 md:w-5 md:h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-stone-700">This Week</p>
                <p className="text-xs text-stone-400">Deployments</p>
              </div>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-stone-900">47</span>
              <span className="text-xs text-emerald-600 font-medium">+23%</span>
            </div>
          </motion.div>

          {/* Success notification */}
          <motion.div
            className="absolute right-4 md:right-24 -bottom-2 md:bottom-8 bg-white rounded-xl shadow-soft-lg border border-emerald-200 p-2.5 md:p-3 flex items-center gap-3 hidden sm:flex"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{
              opacity: 1,
              scale: 1,
              y: shouldReduceMotion ? 0 : [0, -7, 0],
            }}
            transition={{
              opacity: { duration: shouldReduceMotion ? 0 : 0.35, delay: 0.8, ease: [0.25, 0.46, 0.45, 0.94] },
              scale: { duration: shouldReduceMotion ? 0 : 0.35, delay: 0.8, ease: [0.25, 0.46, 0.45, 0.94] },
              y: shouldReduceMotion
                ? { duration: 0 }
                : { duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 0.8 },
            }}
          >
            <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-stone-700">VS Code deployed!</p>
              <p className="text-xs text-stone-400">Just now</p>
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}
