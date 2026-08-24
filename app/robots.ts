import { MetadataRoute } from "next";

const CATALOG_DISALLOW = ["/api/winget/search", "/apps/browse"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/docs/",
          "/blog/",
          "/privacy",
          "/terms",
          "/pricing",
          "/changelog",
          "/about",
        ],
        disallow: [
          "/dashboard/",
          "/auth/",
          "/api/",
          ...CATALOG_DISALLOW,
          "/onboarding/",
        ],
      },
      // Explicitly allow AI engine crawlers for GEO
      {
        userAgent: "GPTBot",
        allow: ["/"],
        disallow: CATALOG_DISALLOW,
      },
      {
        userAgent: "ChatGPT-User",
        allow: ["/"],
        disallow: CATALOG_DISALLOW,
      },
      {
        userAgent: "PerplexityBot",
        allow: ["/"],
        disallow: CATALOG_DISALLOW,
      },
      {
        userAgent: "Google-Extended",
        allow: ["/"],
        disallow: CATALOG_DISALLOW,
      },
      {
        userAgent: "ClaudeBot",
        allow: ["/"],
        disallow: CATALOG_DISALLOW,
      },
      {
        userAgent: "Applebot-Extended",
        allow: ["/"],
        disallow: CATALOG_DISALLOW,
      },
      {
        userAgent: "Anthropic-ai",
        allow: ["/"],
        disallow: CATALOG_DISALLOW,
      },
      {
        userAgent: "CCBot",
        allow: ["/"],
        disallow: CATALOG_DISALLOW,
      },
      {
        userAgent: "Bytespider",
        allow: ["/"],
        disallow: CATALOG_DISALLOW,
      },
    ],
    sitemap: [
      "https://intuneget.com/sitemap/0.xml",
      "https://intuneget.com/sitemap/1.xml",
      "https://intuneget.com/sitemap/2.xml",
    ],
  };
}
