import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/docs/",
          "/privacy",
          "/terms",
          "/pricing",
          "/changelog",
          "/about",
          "/blog/",
        ],
        disallow: ["/dashboard/", "/auth/", "/api/", "/onboarding/"],
      },
      // Explicitly allow AI engine crawlers for GEO
      {
        userAgent: "GPTBot",
        allow: ["/"],
      },
      {
        userAgent: "ChatGPT-User",
        allow: ["/"],
      },
      {
        userAgent: "PerplexityBot",
        allow: ["/"],
      },
      {
        userAgent: "Google-Extended",
        allow: ["/"],
      },
      {
        userAgent: "ClaudeBot",
        allow: ["/"],
      },
      {
        userAgent: "Applebot-Extended",
        allow: ["/"],
      },
      {
        userAgent: "Anthropic-ai",
        allow: ["/"],
      },
      {
        userAgent: "CCBot",
        allow: ["/"],
      },
      {
        userAgent: "Bytespider",
        allow: ["/"],
      },
    ],
    sitemap: "https://intuneget.com/sitemap.xml",
  };
}
