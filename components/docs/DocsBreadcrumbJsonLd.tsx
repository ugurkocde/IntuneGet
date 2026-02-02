"use client";

import { usePathname } from "next/navigation";

const navItemsMap: Record<string, string> = {
  "/docs": "Documentation",
  "/docs/getting-started": "Getting Started",
  "/docs/azure-setup": "Azure AD Setup",
  "/docs/database-setup": "Database Setup",
  "/docs/github-setup": "GitHub Setup",
  "/docs/docker": "Docker",
  "/docs/troubleshooting": "Troubleshooting",
};

export function DocsBreadcrumbJsonLd() {
  const pathname = usePathname();

  const breadcrumbItems = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://intuneget.com",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Documentation",
      item: "https://intuneget.com/docs",
    },
  ];

  // Add current page if it's not the docs index
  if (pathname && pathname !== "/docs" && navItemsMap[pathname]) {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 3,
      name: navItemsMap[pathname],
      item: `https://intuneget.com${pathname}`,
    });
  }

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbItems,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(breadcrumbJsonLd),
      }}
    />
  );
}
