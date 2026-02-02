import { MetadataRoute } from "next";

const BASE_URL = "https://intuneget.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // Static public pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];

  // Documentation pages
  const docPages = [
    "",
    "/getting-started",
    "/azure-setup",
    "/github-setup",
    "/database-setup",
    "/docker",
    "/troubleshooting",
  ];

  const documentationPages: MetadataRoute.Sitemap = docPages.map((path) => ({
    url: `${BASE_URL}/docs${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: path === "" ? 0.9 : 0.7,
  }));

  return [...staticPages, ...documentationPages];
}
