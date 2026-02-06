"use client";

import { cn } from "@/lib/utils";
import Image from "next/image";

interface Logo {
  name: string;
  src: string;
  alt: string;
}

interface LogoBarProps {
  title: string;
  logos: Logo[];
  className?: string;
}

export function LogoBar({ title, logos, className = "" }: LogoBarProps) {
  return (
    <div className={cn("text-center", className)}>
      <p className="text-sm font-medium text-stone-500 uppercase tracking-wider mb-6">
        {title}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
        {logos.map((logo) => (
          <div
            key={logo.name}
            className="group flex items-center gap-2 grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-300"
          >
            <Image
              src={logo.src}
              alt={logo.alt}
              width={32}
              height={32}
              className="w-8 h-8 object-contain"
            />
            <span className="text-sm font-medium text-stone-600 group-hover:text-stone-900">
              {logo.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
