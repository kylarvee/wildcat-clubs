"use client";

import Link from "next/link";
import { memo, type ReactNode } from "react";
import { isExternalHref, parseMarkdown, type Block, type Inline } from "@/lib/ai/markdown";
import { cn } from "@/components/ui/cn";

/**
 * Renders an assistant answer. The model's Markdown is parsed into a small
 * tree (lib/ai/markdown) and drawn as React elements — no HTML from the model
 * ever reaches the page, and only safe links survive parsing.
 */

function Inlines({ nodes, onLinkClick }: { nodes: Inline[]; onLinkClick?: () => void }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return <span key={i}>{n.v}</span>;
          case "br":
            return <br key={i} />;
          case "code":
            return (
              <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-ink">
                {n.v}
              </code>
            );
          case "strong":
            return (
              <strong key={i} className="font-semibold text-ink">
                <Inlines nodes={n.c} onLinkClick={onLinkClick} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inlines nodes={n.c} onLinkClick={onLinkClick} />
              </em>
            );
          case "link":
            return isExternalHref(n.href) ? (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand">
                <Inlines nodes={n.c} />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <Link key={i} href={n.href} onClick={onLinkClick} className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand">
                <Inlines nodes={n.c} />
              </Link>
            );
        }
      })}
    </>
  );
}

function BlockView({ block, onLinkClick }: { block: Block; onLinkClick?: () => void }): ReactNode {
  const inl = (nodes: Inline[]) => <Inlines nodes={nodes} onLinkClick={onLinkClick} />;
  switch (block.t) {
    case "p":
      return <p>{inl(block.c)}</p>;
    case "h": {
      const cls = "font-semibold text-ink";
      if (block.level === 1) return <h3 className={cn(cls, "text-base")}>{inl(block.c)}</h3>;
      if (block.level === 2) return <h4 className={cn(cls, "text-[0.95rem]")}>{inl(block.c)}</h4>;
      return <h5 className={cls}>{inl(block.c)}</h5>;
    }
    case "ul":
      return (
        <ul className="list-disc space-y-1 pl-5 marker:text-ink-3">
          {block.items.map((it, i) => (
            <li key={i}>{inl(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol start={block.start} className="list-decimal space-y-1 pl-5 marker:text-ink-3">
          {block.items.map((it, i) => (
            <li key={i}>{inl(it)}</li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre className="overflow-x-auto rounded-lg bg-[#1d1923] p-3 text-xs leading-relaxed text-[#f4f2f7]">
          <code className="font-mono">{block.v}</code>
        </pre>
      );
    case "quote":
      return <blockquote className="border-l-2 border-brand-200 pl-3 text-ink-2">{inl(block.c)}</blockquote>;
    case "table":
      return (
        <div className="max-w-full overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-muted">
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} scope="col" className="border-b border-line px-2.5 py-1.5 font-semibold text-ink">
                    {inl(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-line last:border-0">
                  {row.map((cell, c) => (
                    <td key={c} className="px-2.5 py-1.5 align-top">
                      {inl(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr className="border-line" />;
  }
}

export const Markdown = memo(function Markdown({ text, onLinkClick, className }: { text: string; onLinkClick?: () => void; className?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className={cn("space-y-2.5 text-sm leading-relaxed text-ink [overflow-wrap:anywhere]", className)}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} onLinkClick={onLinkClick} />
      ))}
    </div>
  );
});
