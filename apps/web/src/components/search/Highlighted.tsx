import type { Segment } from "@/lib/search/types";

/** Search text with the matched words in <mark>. Everything is rendered as text (escaped by React), never as HTML. */
export function Highlighted({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.hit ? (
          <mark key={i} className="rounded-sm bg-amber-100 px-0.5 font-medium text-ink">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
