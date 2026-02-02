"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, ArrowLeft, Github } from "lucide-react";
import { DocsSidebar, MobileDocsSidebar, DocsBreadcrumbJsonLd } from "@/components/docs";
import { cn } from "@/lib/utils";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-bg-deepest">
      <DocsBreadcrumbJsonLd />
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-bg-deepest/80 backdrop-blur-xl">
        <div className="flex h-14 items-center px-4 lg:px-6">
          {/* Mobile menu button */}
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="mr-4 p-2 -ml-2 lg:hidden text-zinc-400 hover:text-white transition-colors"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <Image
              src="/favicon.svg"
              alt="IntuneGet"
              width={24}
              height={24}
              className="h-6 w-6"
            />
            <span className="font-semibold text-white">IntuneGet</span>
          </Link>

          {/* Separator and Docs label */}
          <div className="ml-2 flex items-center gap-2">
            <span className="text-zinc-600">/</span>
            <span className="text-sm font-medium text-zinc-400">Docs</span>
          </div>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-4">
            <Link
              href="/"
              className="hidden sm:flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Home</span>
            </Link>
            <Link
              href="https://github.com/ugurkocde/IntuneGet"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-zinc-400 hover:text-white transition-colors"
              aria-label="GitHub"
            >
              <Github className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-64 flex-shrink-0 border-r border-white/5">
          <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-6 px-4">
            <DocsSidebar />
          </div>
        </aside>

        {/* Mobile Sidebar */}
        <MobileDocsSidebar
          isOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
        />

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <div className="mx-auto max-w-4xl px-4 py-8 lg:px-8 lg:py-12">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
