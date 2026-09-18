import { Metadata } from "next";
import Link from "next/link";
import { T } from "gt-next";
import { ArrowRight, CheckCircle, ExternalLink, PackageCheck, ShieldCheck } from "lucide-react";
import { Callout, CodeBlock } from "@/components/docs";

export const metadata: Metadata = {
  title: "Packaging & Verification | IntuneGet Docs",
  description:
    "How IntuneGet builds a Win32 package from a public WinGet manifest, what is pinned, and how to verify a package yourself.",
  alternates: {
    canonical: "https://intuneget.com/docs/packaging",
  },
  openGraph: {
    title: "Packaging & Verification | IntuneGet Docs",
    description:
      "How IntuneGet builds a Win32 package from a public WinGet manifest, what is pinned, and how to verify a package yourself.",
  },
};

const pipeline = `1. Resolve   Read the WinGet manifest from microsoft/winget-pkgs for the app and version.
2. Download  Fetch the installer from the manifest URL.
3. Verify    Compare the installer SHA-256 against the manifest. Mismatch fails the build.
4. Wrap      Generate a PSADT 4.1.8 package (commands, detection, dialogs).
5. Package   Build the .intunewin with the Microsoft Win32 Content Prep Tool.
6. Upload    Create the Win32 app in your Intune tenant and upload the content.`;

const pinned = [
  {
    label: "Installers",
    value: "Downloaded from the WinGet community manifest and copied byte-for-byte. Never modified, never re-signed.",
  },
  {
    label: "Installer hash",
    value: "SHA-256 verified against the manifest before packaging (strict mode). A mismatch fails the build.",
  },
  {
    label: "PSADT",
    value: "Version 4.1.8, downloaded from a pinned URL and verified against a pinned SHA-256.",
  },
  {
    label: "Win32 Content Prep Tool",
    value: "Microsoft IntuneWinAppUtil, downloaded from a pinned URL and verified against a pinned SHA-256.",
  },
  {
    label: "Packaging scripts",
    value: "The public IntuneGet packaging scripts, checked out at a reviewed commit that is recorded for each build.",
  },
];

export default function PackagingDocsPage() {
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>Packaging &amp; Verification</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>
            Every package IntuneGet deploys is built from a public WinGet manifest by a pinned,
            repeatable pipeline. This page describes each step and how to verify a package without
            taking our word for it.
          </T>
        </p>
      </div>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>How a package is built</T>
        </h2>
        <CodeBlock language="text" filename="package pipeline">{pipeline}</CodeBlock>
        <p className="text-text-secondary">
          <T>
            The packaging step runs in an ephemeral, hosted runner. The installer and the built
            package exist only for the duration of the job and are then discarded.
          </T>
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>What is pinned</T>
        </h2>
        <div className="space-y-3">
          {pinned.map((row) => (
            <div
              key={row.label}
              className="rounded-lg border border-overlay/10 bg-bg-elevated p-4"
            >
              <h3 className="font-semibold text-text-primary">{row.label}</h3>
              <p className="mt-1 text-sm text-text-secondary">{row.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Verify a package yourself</T>
        </h2>
        <ul className="space-y-4">
          <li className="flex gap-3">
            <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent-cyan" aria-hidden="true" />
            <div className="text-text-secondary">
              <T>
                <span className="font-medium text-text-primary">On the app page.</span> Each app
                shows the installer source, the installer SHA-256, the PSADT version, the packaging
                commit, and the tested package profile.
              </T>
            </div>
          </li>
          <li className="flex gap-3">
            <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent-cyan" aria-hidden="true" />
            <div className="text-text-secondary">
              <T>
                <span className="font-medium text-text-primary">In the QA report.</span> The
                per-version report records the outcome, install and uninstall phases, detection,
                captured commands, and the VirusTotal result for the installer hash.
              </T>
            </div>
          </li>
          <li className="flex gap-3">
            <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent-cyan" aria-hidden="true" />
            <div className="text-text-secondary">
              <T>
                <span className="font-medium text-text-primary">Against the manifest.</span> Open
                the app in the WinGet manifest and compare the recorded SHA-256 with the one shown
                on the app page.
              </T>
            </div>
          </li>
          <li className="flex gap-3">
            <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent-cyan" aria-hidden="true" />
            <div className="text-text-secondary">
              <T>
                <span className="font-medium text-text-primary">By running it yourself.</span> Clone
                the repository and self-host to run the same pipeline with your own app
                registration.
              </T>
            </div>
          </li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link href="/apps" className="inline-flex items-center gap-1 font-medium text-accent-cyan hover:underline">
            <T>Browse the app catalog</T>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <Link href="/qa" className="inline-flex items-center gap-1 font-medium text-accent-cyan hover:underline">
            <T>See recent QA results</T>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <Link href="/docs/docker" className="inline-flex items-center gap-1 font-medium text-accent-cyan hover:underline">
            <T>Self-host with Docker</T>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <Callout type="info" title="Source of truth">
        <p>
          <T>
            Catalog data comes from the WinGet community manifests at
          </T>{" "}
          <a
            href="https://github.com/microsoft/winget-pkgs"
            target="_blank"
            rel="noopener nofollow"
            className="inline-flex items-center gap-1 text-accent-cyan hover:underline"
          >
            microsoft/winget-pkgs
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <T>. The manifests, including their SHA-256 values, are public and can be checked against any package.</T>
        </p>
      </Callout>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Limits to know about</T>
        </h2>
        <div className="flex gap-3 rounded-lg border border-overlay/10 bg-bg-elevated p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent-cyan" aria-hidden="true" />
          <ul className="space-y-2 text-sm text-text-secondary">
            <li>
              <T>
                The hosted packaging workflow runs in a private repository to keep tenant
                identifiers out of public workflow runs. The packaging scripts themselves are open
                source and used for every build.
              </T>
            </li>
            <li>
              <T>
                A mismatch between the manifest hash and the downloaded file fails the build rather
                than shipping a package.
              </T>
            </li>
            <li>
              <T>
                WinGet is a community source. If that risk profile does not fit your organization,
                self-host and point IntuneGet at your own catalog.
              </T>
            </li>
          </ul>
        </div>
      </section>

      <div className="flex items-center gap-3 rounded-lg border border-accent-cyan/20 bg-accent-cyan/5 p-4">
        <PackageCheck className="h-5 w-5 flex-shrink-0 text-accent-cyan" aria-hidden="true" />
        <p className="text-sm text-text-secondary">
          <T>See the full permission list and data flow on the security page.</T>{" "}
          <Link href="/security" className="font-medium text-accent-cyan hover:underline">
            <T>Open the security page</T>
          </Link>
        </p>
      </div>
    </div>
  );
}
