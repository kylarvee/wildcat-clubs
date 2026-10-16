"use client";

import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/misc";

/** A read-only value with a Copy button (feed URLs, links). */
export function CopyField({ value, label, hint }: { value: string; label: string; hint?: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.");
    }
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-ink-3">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 min-w-0 flex-1 rounded-lg border border-line-2 bg-muted/50 px-2.5 font-mono text-xs text-ink-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        <Button variant="outline" size="sm" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}
