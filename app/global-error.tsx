"use client";

import { useEffect } from "react";
import { reportPageError } from "@/lib/logging/report-page-error";

export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { reportPageError('root', error.digest); }, [error]);
  return (
    <html lang="en">
      <body>
        <main>
          <h1>Unable to load this page</h1>
          <p>Please try again in a moment.</p>
          <button onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
