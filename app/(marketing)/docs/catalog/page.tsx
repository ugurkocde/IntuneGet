import { Metadata } from "next";
import Link from "next/link";
import { T } from "gt-next";
import { ArrowRight, ExternalLink, Library, ShieldAlert } from "lucide-react";
import { Callout, CodeBlock } from "@/components/docs";

export const metadata: Metadata = {
  title: "Catalog & Supply Chain | IntuneGet Docs",
  description:
    "Where the IntuneGet catalog comes from, what is stored, whether installer binaries are mirrored, and the state of a private catalog.",
  alternates: {
    canonical: "https://www.intuneget.com/docs/catalog",
  },
  openGraph: {
    title: "Catalog & Supply Chain | IntuneGet Docs",
    description:
      "Where the IntuneGet catalog comes from, what is stored, whether installer binaries are mirrored, and the state of a private catalog.",
  },
};

const questions = [
  {
    q: "Where does the catalog come from?",
    a: "The WinGet community manifests at microsoft/winget-pkgs. A scheduled sync reads versions, installer URLs, SHA-256 values, and locale variants into the IntuneGet catalog.",
  },
  {
    q: "Does IntuneGet mirror winget like cdn.winget.microsoft.com/cache?",
    a: "No. IntuneGet does not run a CDN mirror of winget and does not host installer binaries. The catalog stores metadata; the installer is fetched from its upstream vendor URL at packaging time and discarded afterward.",
  },
  {
    q: "Do you store the built package?",
    a: "No. The .intunewin is built on an ephemeral runner, uploaded to your tenant, and then discarded. It is never stored by IntuneGet.",
  },
  {
    q: "Is there a private catalog?",
    a: "Not today. The catalog is the public verified set, and you can add your own apps by pointing at a public installer URL. A tenant-private catalog is planned; see the roadmap for status.",
  },
  {
    q: "Can I use my own source?",
    a: "Yes, by self-hosting. The catalog is served from a snapshot you can host or point at a local file, so you decide which manifests feed your deployment.",
  },
];

export default function CatalogDocsPage() {
  return (
    <div className="space-y-12">
      <div>
        <div className="flex items-center gap-3">
          <Library className="h-7 w-7 text-accent-cyan" aria-hidden="true" />
          <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
            <T>Catalog &amp; Supply Chain</T>
          </h1>
        </div>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>
            The catalog decides which apps exist and where each installer comes from. This page
            answers the supply-chain questions admins ask most.
          </T>
        </p>
      </div>

      <section className="space-y-4">
        {questions.map((item) => (
          <div key={item.q} className="rounded-lg border border-overlay/10 bg-bg-elevated p-5">
            <h2 className="text-lg font-semibold text-text-primary"><T>{item.q}</T></h2>
            <p className="mt-2 text-sm text-text-secondary leading-relaxed"><T>{item.a}</T></p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>How the sync works</T>
        </h2>
        <CodeBlock language="text">
{`winget-pkgs (community manifests)
        |
        v
scheduled sync  ->  IntuneGet catalog (metadata + SHA-256)
        |
        v
packaging run   ->  fetch installer from vendor URL, verify SHA-256, discard`}
        </CodeBlock>
      </section>

      <Callout type="warning" title="WinGet is a community source">
        <p>
          <T>
            Anyone can submit a manifest. A manifest is a pointer to a vendor installer plus a
            hash, not a guarantee about the vendor. If that risk profile does not fit your
            organization, self-host and point IntuneGet at your own catalog rather than the public
            one.
          </T>
        </p>
      </Callout>

      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/docs/packaging" className="inline-flex items-center gap-1 font-medium text-accent-cyan hover:underline">
          <T>How a package is built and verified</T>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        <Link href="/roadmap" className="inline-flex items-center gap-1 font-medium text-accent-cyan hover:underline">
          <T>See the roadmap</T>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        <a
          href="https://github.com/microsoft/winget-pkgs"
          target="_blank"
          rel="noopener nofollow"
          className="inline-flex items-center gap-1 font-medium text-accent-cyan hover:underline"
        >
          microsoft/winget-pkgs
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-accent-cyan/20 bg-accent-cyan/5 p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent-cyan" aria-hidden="true" />
        <p className="text-sm text-text-secondary">
          <T>
            Self-hosting is the way to keep the catalog and the pipeline entirely inside your
            infrastructure. Start with the
          </T>{" "}
          <Link href="/docs/docker" className="font-medium text-accent-cyan hover:underline">
            <T>Docker guide</T>
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
