import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/docs/", "/privacy", "/terms"],
        disallow: ["/dashboard/", "/auth/", "/api/", "/onboarding/"],
      },
    ],
    sitemap: "https://intuneget.com/sitemap.xml",
  };
}
