import type { ReactNode } from "react";
import { linkifyParts } from "@/components/messages/format";
import { cn } from "@/components/ui/cn";

/** A message body as plain text: line breaks kept, http(s) and www. links clickable. Never renders HTML. */
export function MessageText({ body, suffix, className }: { body: string; suffix?: ReactNode; className?: string }) {
  return (
    <p className={cn("whitespace-pre-wrap break-words text-sm leading-relaxed text-ink [overflow-wrap:anywhere]", className)}>
      {linkifyParts(body).map((p, i) =>
        p.type === "link" ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-brand-600 underline underline-offset-2 hover:text-brand-700">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
      {suffix}
    </p>
  );
}
