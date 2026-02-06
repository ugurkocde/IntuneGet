"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { DocsSidebar, MobileDocsSidebar, DocsBreadcrumbJsonLd } from "@/components/docs";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-bg-deepest flex flex-col">
      <Header />
      <DocsBreadcrumbJsonLd />

      <div className="flex-1 pt-16">
        <div className="mx-auto max-w-7xl px-4 md:px-6">
          <div className="flex">
            {/* Desktop Sidebar */}
            <aside className="hidden lg:block w-64 flex-shrink-0 border-r border-black/5">
              <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-6 pr-4">
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
              {/* Mobile docs navigation toggle */}
              <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-black/5">
                <button
                  onClick={() => setIsMobileMenuOpen(true)}
                  className="p-1.5 -ml-1.5 text-text-muted hover:text-text-primary transition-colors"
                  aria-label="Open documentation navigation"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <span className="text-sm font-medium text-text-secondary">
                  Documentation
                </span>
              </div>

              <div className="max-w-4xl py-8 lg:pl-8 lg:py-12">
                {children}
              </div>
            </main>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
