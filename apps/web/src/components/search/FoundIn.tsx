import Link from "next/link";
import { TextSearch } from "lucide-react";
import type { SearchMatch } from "@/lib/search/types";
import { segmentsText } from "@/lib/search/types";
import { cn } from "@/components/ui/cn";
import { Highlighted } from "@/components/search/Highlighted";

/**
 * Where a search found its words when the club's card doesn't show them:
 * "Found in Event · “Girls in STEM Robot Day”" and the passage around the
 * match. Links to where the text lives. Only ever built from what the viewer
 * may see (lib/search).
 */
export function FoundIn({ match, className, compact = false }: { match: SearchMatch; className?: string; compact?: boolean }) {
  const title = segmentsText(match.title);
  return (
    <div className={cn(compact ? "text-xs text-ink-3" : "rounded-lg bg-muted/70 px-3 py-2 text-xs leading-relaxed text-ink-2", className)}>
      <p className="flex min-w-0 items-start gap-1.5">
        <TextSearch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden="true" />
        <span className="min-w-0">
          <span className="text-ink-3">Found in </span>
          <Link href={match.href} className="font-medium text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand">
            {match.label}
            {title ? (
              <>
                {" · "}“<Highlighted segments={match.title} />”
              </>
            ) : null}
          </Link>
        </span>
      </p>
      {match.snippet && !compact ? (
        <p className="mt-1 line-clamp-3 pl-5 text-ink-2">
          <Highlighted segments={match.snippet} />
        </p>
      ) : null}
    </div>
  );
}
