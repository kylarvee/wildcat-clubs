import { splitMissing, type RenderedDoc } from "@/lib/constitution/render";
import { cn } from "@/components/ui/cn";

function Text({ text }: { text: string }) {
  return (
    <>
      {splitMissing(text).map((r, i) =>
        r.missing ? (
          <mark key={i} className="rounded bg-amber-100 px-1 font-sans text-[0.85em] font-medium text-amber-900">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

/**
 * A constitution or bylaws document as it will read once adopted — the same
 * structure the PDF prints. Missing fill-ins are highlighted.
 */
export function DocPreview({ doc, className, highlight }: { doc: RenderedDoc; className?: string; highlight?: string | null }) {
  return (
    <article className={cn("font-serif text-[15px] leading-relaxed text-ink", className)} aria-label={`${doc.label} preview`}>
      <p className="font-sans text-[11px] font-bold uppercase tracking-[0.18em] text-brand">{doc.label}</p>
      <h2 className="mt-1 text-2xl font-bold leading-tight">
        <Text text={doc.clubName} />
      </h2>
      <div className="mt-3 h-0.5 w-14 bg-brand" aria-hidden />
      <p className="mt-4 italic text-ink-2">
        <Text text={doc.preamble} />
      </p>
      {doc.articles.map((a) => {
        let n = 0;
        return (
          <section key={a.id} id={`preview-${a.id}`} className={cn("mt-6 scroll-mt-24 rounded-lg transition-colors", highlight === a.id && "bg-brand-50/70 ring-4 ring-brand-50")}>
            <p className="font-sans text-[10px] font-bold uppercase tracking-[0.15em] text-brand">Article {a.roman}</p>
            <h3 className="text-lg font-bold">{a.title}</h3>
            <div className="mt-2 space-y-2">
              {a.blocks.map((b, i) =>
                b.type === "p" ? (
                  <p key={i} className="flex gap-2">
                    <span className="w-5 shrink-0 font-bold">{++n}.</span>
                    <span className="min-w-0">
                      <Text text={b.text} />
                    </span>
                  </p>
                ) : (
                  <ul key={i} className="ml-7 list-disc space-y-1 pl-4">
                    {b.items.map((item, j) => (
                      <li key={j}>
                        <Text text={item} />
                      </li>
                    ))}
                  </ul>
                ),
              )}
            </div>
          </section>
        );
      })}
    </article>
  );
}
