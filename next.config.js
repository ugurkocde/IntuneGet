const { withGTConfig } = require("gt-next/config");

// Vercel can expose development-only translation credentials to every
// environment. Never let those credentials reach a production Next.js build.
if (process.env.NODE_ENV === "production") {
  delete process.env.GT_DEV_API_KEY;
  delete process.env.NEXT_PUBLIC_GT_DEV_API_KEY;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "intuneget.com",
      },
      {
        protocol: "https",
        hostname: "store-images.s-microsoft.com",
      },
      {
        protocol: "https",
        hostname: "store-images.microsoft.com",
      },
    ],
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        // Cache app icons for 1 year (immutable assets)
        source: "/icons/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

module.exports = withGTConfig(nextConfig);
