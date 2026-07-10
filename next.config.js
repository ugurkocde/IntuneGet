const { withGTConfig } = require("gt-next/config");

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
