import { Metadata } from "next";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";

export const metadata: Metadata = {
  title: {
    template: "%s | IntuneGet Blog",
    default: "Blog | IntuneGet",
  },
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg-deepest flex flex-col">
      <Header />
      <main className="flex-1 pt-20">{children}</main>
      <Footer />
    </div>
  );
}
