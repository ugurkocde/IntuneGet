import { Metadata } from "next";
import Link from "next/link";
import { blogPosts } from "@/lib/data/blog-data";
import { ArrowRight, Calendar, Clock, Tag } from "lucide-react";
import { T } from "gt-next";

export const metadata: Metadata = {
  title: "Blog | IntuneGet - Winget to Intune Guides & Tutorials",
  description:
    "Guides, tutorials, and best practices for deploying Winget apps to Microsoft Intune. Learn from real-world IT deployment workflows.",
  alternates: {
    canonical: "https://intuneget.com/blog",
  },
  openGraph: {
    title: "IntuneGet Blog - Winget to Intune Deployment Guides",
    description:
      "Practical guides and tutorials for IT admins deploying Winget apps to Microsoft Intune.",
    url: "https://intuneget.com/blog",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "IntuneGet Blog - Winget to Intune Deployment Guides",
    description:
      "Practical guides and tutorials for IT admins deploying Winget apps to Microsoft Intune.",
  },
};

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://intuneget.com",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Blog",
      item: "https://intuneget.com/blog",
    },
  ],
};

const collectionPageJsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "IntuneGet Blog - Winget to Intune Deployment Guides",
  description:
    "Practical guides and tutorials for IT admins deploying Winget apps to Microsoft Intune.",
  url: "https://intuneget.com/blog",
  mainEntity: {
    "@type": "ItemList",
    itemListElement: blogPosts.map((post, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `https://intuneget.com/blog/${post.slug}`,
      name: post.title,
    })),
  },
};

export default function BlogPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionPageJsonLd) }}
      />
      <div className="container px-4 md:px-6 mx-auto max-w-5xl py-12 md:py-16">
        {/* Page header */}
        <div className="mb-12 md:mb-16 space-y-4">
          <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase">
            <T>Blog</T>
          </span>
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-text-primary tracking-tight">
            <T>Winget to Intune Deployment Guides</T>
          </h1>
          <p className="max-w-2xl text-lg text-text-secondary">
            <T>Practical tutorials and best practices for IT teams deploying
            applications to Microsoft Intune using Winget.</T>
          </p>
        </div>

        {/* Blog post cards */}
        <div className="space-y-6">
          {blogPosts.map((post) => {
            const formattedDate = new Date(post.date).toLocaleDateString(
              "en-US",
              { year: "numeric", month: "long", day: "numeric" }
            );

            return (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group block p-6 md:p-8 rounded-2xl bg-bg-elevated border border-overlay/[0.06] shadow-card hover:shadow-card-hover hover:border-overlay/10 transition-all duration-300"
              >
                <div className="flex flex-col gap-4">
                  {/* Tags */}
                  <div className="flex flex-wrap gap-2">
                    {post.isPillar && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent-cyan text-white">
                        <T>Featured Guide</T>
                      </span>
                    )}
                    {post.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-overlay/[0.06] text-text-muted"
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Title and description */}
                  <h2 className="text-xl md:text-2xl font-bold text-text-primary group-hover:text-accent-cyan transition-colors">
                    <T>{post.title}</T>
                  </h2>
                  <p className="text-text-secondary leading-relaxed">
                    <T>{post.description}</T>
                  </p>

                  {/* Meta and CTA */}
                  <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                    <div className="flex items-center gap-4 text-sm text-text-muted">
                      <span>{post.author}</span>
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {formattedDate}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {post.readTime}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-cyan group-hover:gap-2.5 transition-all">
                      <T>Read more</T>
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
