import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IntuneGet - Deploy Winget Apps to Intune",
    short_name: "IntuneGet",
    description:
      "Streamline your Microsoft Intune app deployment process with Winget integration. Package and upload applications effortlessly.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0f",
    theme_color: "#06b6d4",
    icons: [
      {
        src: "/logo-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/logo-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/logo-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
