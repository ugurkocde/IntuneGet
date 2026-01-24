"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  children: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
}

export function CodeBlock({
  children,
  language = "bash",
  filename,
  showLineNumbers = false,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = children.split("\n");

  return (
    <div className="relative group my-4 rounded-lg overflow-hidden border border-white/10 bg-bg-surface">
      {/* Header with filename and copy button */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-500">{language}</span>
          {filename && (
            <>
              <span className="text-zinc-600">|</span>
              <span className="text-xs font-mono text-zinc-400">{filename}</span>
            </>
          )}
        </div>
        <button
          onClick={copyToClipboard}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all duration-200",
            copied
              ? "text-status-success bg-status-success/10"
              : "text-zinc-400 hover:text-white hover:bg-white/5"
          )}
          aria-label={copied ? "Copied!" : "Copy code"}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code content */}
      <div className="overflow-x-auto">
        <pre className="p-4 text-sm font-mono leading-relaxed">
          <code>
            {showLineNumbers ? (
              lines.map((line, index) => (
                <div key={index} className="flex">
                  <span className="select-none text-zinc-600 w-8 flex-shrink-0 text-right pr-4">
                    {index + 1}
                  </span>
                  <span className="text-zinc-300">{line}</span>
                </div>
              ))
            ) : (
              <span className="text-zinc-300">{children}</span>
            )}
          </code>
        </pre>
      </div>
    </div>
  );
}
