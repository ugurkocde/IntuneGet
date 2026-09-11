"use client";

import { useId, useRef, useState } from "react";
import { T } from "gt-next";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export function ReleaseFeedDialog({ app }: { app?: string }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const feedUrl = `https://intuneget.com/apps/releases/feed${app ? `?app=${encodeURIComponent(app)}` : ""}`;

  async function copyUrl() {
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(feedUrl);
      setStatus("copied");
    } catch {
      setStatus("error");
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

  return (
    <Dialog onOpenChange={() => setStatus("idle")}>
      <DialogTrigger asChild>
        <button type="button" className="rounded-sm text-accent-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
          <T>Subscribe via RSS</T>
        </button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain motion-reduce:animate-none">
        <DialogHeader className="pr-12">
          <DialogTitle><T>Subscribe via RSS</T></DialogTitle>
          <DialogDescription className="mt-2">
            <T>Copy this URL and paste it into your RSS reader to follow release updates.</T>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 p-6">
          {app && <p className="break-words text-sm text-text-secondary" translate="no">{app}</p>}
          <label htmlFor={inputId} className="block text-sm font-medium text-text-primary"><T>Feed URL</T></label>
          <input
            ref={inputRef} id={inputId} name="feedUrl" type="url" readOnly value={feedUrl}
            autoComplete="off" spellCheck={false} translate="no"
            onFocus={(event) => event.currentTarget.select()}
            className="w-full min-w-0 rounded-lg border border-overlay/15 bg-bg-elevated px-3 py-2.5 text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan sm:text-sm"
          />
          <Button type="button" onClick={copyUrl} disabled={status === "copying"} className="w-full bg-accent-cyan-dim text-white hover:bg-accent-cyan-dim/90 sm:w-auto">
            {status === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {status === "copied" ? <T>Copied</T> : status === "copying" ? <T>Copying…</T> : <T>Copy URL</T>}
          </Button>
          <p role="status" className="text-sm text-text-secondary">
            {status === "copied" && <T>Feed URL copied. Paste it into your RSS reader.</T>}
            {status === "error" && <T>Automatic copying is unavailable. Select and copy the URL above.</T>}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
