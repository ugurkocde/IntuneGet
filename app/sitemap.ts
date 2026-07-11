import { MetadataRoute } from "next";
import { blogPosts } from "@/lib/data/blog-data";

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
      url: `${BASE_URL}/apps`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/pricing`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/changelog`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/security`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
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
    "/environment-reference",
    "/api-reference",
    "/sccm-migration",
    "/updates-policies",
    "/inventory-reports-uploads",
    "/unmanaged-apps",
    "/msp",
    "/settings",
    "/troubleshooting",
  ];

  const documentationPages: MetadataRoute.Sitemap = docPages.map((path) => ({
    url: `${BASE_URL}/docs${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: path === "" ? 0.9 : 0.7,
  }));

  // Blog pages
  const blogIndex: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/blog`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];

  const blogPostPages: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: "monthly" as const,
    priority: post.isPillar ? 0.9 : 0.7,
  }));

  return [...staticPages, ...documentationPages, ...blogIndex, ...blogPostPages];
}
