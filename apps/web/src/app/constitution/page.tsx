import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Gavel, ScrollText } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { fmtAgo } from "@/lib/time";
import { SECTIONS } from "@/lib/constitution/templates";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Container, EmptyState, PageHeader } from "@/components/ui/layout";
import { DeleteDraftButton, NewDraftButton } from "@/components/constitution/DraftControls";

export const metadata: Metadata = { title: "Constitution builder" };

export default async function ConstitutionHome() {
  const user = await requireUser("/constitution");
  const drafts = await db.constitutionDraft.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      documents: { where: { kind: "CONSTITUTION" }, orderBy: { createdAt: "desc" }, select: { status: true, version: true, createdAt: true, club: { select: { name: true, slug: true } } } },
    },
  });
  const core = SECTIONS.constitution.filter((s) => s.core).length + SECTIONS.bylaws.filter((s) => s.core).length;
  const modular = SECTIONS.constitution.filter((s) => !s.core).length + SECTIONS.bylaws.filter((s) => !s.core).length;

  return (
    <Container>
      <PageHeader
        title="Constitution builder"
        description="Every club needs a constitution and bylaws. Start from defaults written for Weber State clubs and Wildcat Clubs, turn optional sections on or off, fill in the blanks, and adopt them for any club you lead."
        actions={<NewDraftButton>New draft</NewDraftButton>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {drafts.length ? (
            <Card>
              <CardHeader title="Your drafts" description="Drafts belong to you, so you can reuse one for several clubs." />
              <ul className="divide-y divide-line">
                {drafts.map((d) => {
                  const adoptedBy = [...new Map(d.documents.map((x) => [x.club.slug, x])).values()];
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <ScrollText className="h-5 w-5 shrink-0 text-ink-3" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <Link href={`/constitution/${d.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                          {d.title}
                        </Link>
                        <p className="text-xs text-ink-3">
                          Edited {fmtAgo(d.updatedAt)}
                          {adoptedBy.length ? ` · adopted for ${adoptedBy.map((x) => x.club.name).join(", ")}` : ""}
                        </p>
                      </div>
                      {adoptedBy.some((x) => x.status === "ACTIVE") ? <Badge tone="success">In effect</Badge> : adoptedBy.length ? <Badge>Earlier version</Badge> : <Badge tone="warning">Draft</Badge>}
                      <DeleteDraftButton draftId={d.id} title={d.title} adopted={adoptedBy.length > 0} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : (
            <EmptyState
              icon={<Gavel />}
              title="No drafts yet"
              description="Start a draft to see the default constitution and bylaws. Nothing is official until you adopt it for a club."
              action={<NewDraftButton>Start your first draft</NewDraftButton>}
            />
          )}
        </div>
        <aside className="space-y-4">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-ink-3" aria-hidden /> How it works</span>} />
            <CardBody className="space-y-3 text-sm text-ink-2">
              <p>
                <span className="font-medium text-ink">{core} core sections</span> are required — name, purpose, membership, leadership, advisor, finances, succession and more.
              </p>
              <p>
                <span className="font-medium text-ink">{modular} optional sections</span> cover things like dues, committees, travel and quorum.
              </p>
              <p>Adopting saves both documents as PDFs in your club&apos;s files and applies their rules: how students join and how leaders are chosen.</p>
              <p className="text-ink-3">Prefer your own documents? After your club has run for a year, you can upload a custom constitution for WSUSA approval from your club&apos;s Constitution page.</p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </Container>
  );
}
