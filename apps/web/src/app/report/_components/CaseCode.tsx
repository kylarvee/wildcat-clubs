"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/misc";

/** A case code shown big enough to write down, with a copy button. */
export function CaseCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Case code copied");
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy automatically — select the code and copy it, or write it down.");
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-dashed border-brand-200 bg-brand-50/60 px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-700">Your case code</p>
        <p className="mt-1 select-all font-mono text-3xl font-bold tracking-[0.12em] text-ink sm:text-4xl" aria-label={`Case code ${code.split("").join(" ")}`}>
          {code}
        </p>
      </div>
      <Button variant="outline" onClick={copy} aria-label={copied ? "Copied" : `Copy case code ${code}`}>
        {copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {copied ? "Copied" : "Copy code"}
      </Button>
    </div>
  );
}
