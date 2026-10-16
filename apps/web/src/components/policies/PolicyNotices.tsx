import Link from "next/link";
import type { PolicyPlacement } from "@prisma/client";
import { ScrollText } from "lucide-react";
import { db } from "@/lib/db";

/**
 * Shows the published policies that admins attached to this part of the app.
 * Admins write policy once (Policy editor); it appears everywhere its
 * placements say, through this component only.
 */
export async function PolicyNotices({ placement, className, title = "Policies that apply here" }: { placement: PolicyPlacement; className?: string; title?: string }) {
  const policies = await db.policy.findMany({
    where: { status: "PUBLISHED", placements: { has: placement } },
    orderBy: { title: "asc" },
    select: { slug: true, title: true, summary: true },
  });
  if (policies.length === 0) return null;
  return (
    <aside className={"rounded-xl border border-brand-100 bg-brand-50/60 p-4 " + (className ?? "")} aria-label={title}>
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-700">
        <ScrollText className="h-4 w-4" /> {title}
      </p>
      <ul className="space-y-2">
        {policies.map((p) => (
          <li key={p.slug} className="text-sm">
            <Link href={`/policies/${p.slug}`} className="font-medium text-brand-600 underline-offset-2 hover:underline">
              {p.title}
            </Link>
            <span className="text-ink-2"> — {p.summary}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
