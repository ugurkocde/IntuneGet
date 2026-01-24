"use client";

import { AlertCircle, Sparkles, X } from "lucide-react";
import { useState } from "react";

export function AnnouncementBanner() {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  return (
    <div className="relative bg-gradient-to-r from-blue-600 via-blue-700 to-purple-600 text-white overflow-hidden">
      {/* Animated background pattern */}
      <div className="absolute inset-0 bg-grid-white/10 [mask-image:radial-gradient(white,transparent_70%)]" />
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-pulse-slow" />

      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-2 left-1/4 w-1 h-1 bg-white/30 rounded-full animate-float" />
        <div className="absolute top-4 right-1/3 w-1.5 h-1.5 bg-white/20 rounded-full animate-float animation-delay-1000" />
        <div className="absolute bottom-3 left-1/3 w-1 h-1 bg-white/25 rounded-full animate-float animation-delay-2000" />
      </div>

      <div className="relative px-4 py-3">
        <div className="flex items-center justify-center gap-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-2 animate-fade-in">
            <div className="relative">
              <Sparkles className="h-4 w-4 text-yellow-300 animate-pulse" />
              <div className="absolute inset-0 h-4 w-4 text-yellow-300 animate-ping opacity-30">
                <Sparkles className="h-4 w-4" />
              </div>
            </div>
            <AlertCircle className="h-4 w-4 text-white/90" />
          </div>

          <p className="text-sm font-medium text-center animate-fade-in animation-delay-200">
            <span className="hidden sm:inline">🚀 </span>
            <span className="font-semibold">IntuneGet is coming soon!</span>
            <span className="hidden sm:inline">
              {" "}
              Join the waitlist for early access and exclusive updates.
            </span>
            <span className="sm:hidden"> Join our waitlist!</span>
          </p>

          <button
            onClick={() => setIsVisible(false)}
            className="ml-2 p-1 rounded-full hover:bg-white/10 transition-colors duration-200 animate-fade-in animation-delay-400"
            aria-label="Close announcement"
          >
            <X className="h-4 w-4 text-white/80 hover:text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
