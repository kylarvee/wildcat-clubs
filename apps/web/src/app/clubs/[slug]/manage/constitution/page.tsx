import type { Metadata } from "next";
import Link from "next/link";
import { Download, ExternalLink, FileText, PenLine } from "lucide-react";
import { db } from "@/lib/db";
import { DAY_MS, fmtLongDate } from "@/lib/time";
import { fileUrl } from "@/lib/domain/files";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { workspaceTitle } from "@/components/founding/workspaceTitle";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, KeyValue, PageHeader } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { RichContent } from "@/components/rich/RichContent";
import { NoPermission } from "@/components/workspace/NoPermission";
import { NewDraftButton } from "@/components/constitution/DraftControls";
import { CustomUploadForm, WithdrawButton } from "@/components/constitution/CustomUploadForm";
import { JOIN_LABEL, SUCCESSION_LABEL } from "@/components/founding/copy";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return workspaceTitle((await params).slug, "Constitution");
}

const KIND_LABEL = { CONSTITUTION: "Constitution", BYLAWS: "Bylaws" } as const;
const STATUS = {
  ACTIVE: { label: "In effect", tone: "success" },
  PENDING_APPROVAL: { label: "Waiting for WSUSA", tone: "info" },
  SUPERSEDED: { label: "Replaced", tone: "neutral" },
  REJECTED: { label: "Not approved", tone: "danger" },
} as const;

export default async function ClubConstitutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, club, access, allowed } = await loadClubWorkspace(slug, "constitution");
  const readOnly = club.status === "RETIRED" || club.status === "REJECTED";
  // Retired clubs keep their documents readable for leaders and admins; everything else needs the capability.
  if (!allowed && !(readOnly && access.isLeader)) return <NoPermission what="the constitution and bylaws" suspended={access.suspended} />;

  const [docs, myDrafts, rejections] = await Promise.all([
    db.clubDocument.findMany({
      where: { clubId: club.id, kind: { in: ["CONSTITUTION", "BYLAWS"] } },
      orderBy: [{ createdAt: "desc" }],
      include: { createdBy: { select: { name: true } }, draft: { select: { id: true, ownerId: true } } },
    }),
    db.constitutionDraft.findMany({ where: { ownerId: user.id }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, updatedAt: true } }),
    db.clubDecision.findMany({ where: { clubId: club.id, action: "DOCUMENT_REJECTED" }, orderBy: { at: "desc" }, take: 1, include: { by: { select: { name: true } } } }),
  ]);

  const current = (kind: "CONSTITUTION" | "BYLAWS") => docs.find((d) => d.kind === kind && d.status === "ACTIVE") ?? null;
  const pending = (kind: "CONSTITUTION" | "BYLAWS") => docs.find((d) => d.kind === kind && d.status === "PENDING_APPROVAL") ?? null;
  const activeBuilder = docs.find((d) => d.status === "ACTIVE" && d.source === "BUILDER" && d.draft);
  const myActiveDraft = activeBuilder?.draft?.ownerId === user.id ? activeBuilder.draft : null;
  const otherDrafts = myDrafts.filter((d) => d.id !== myActiveDraft?.id);
  const latest = docs[0];
  const lastRejection = latest?.status === "REJECTED" ? rejections[0] : null;
  const runningDays = club.approvedAt ? Math.floor((Date.now() - club.approvedAt.getTime()) / DAY_MS) : 0;
  const canEdit = allowed && !readOnly;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Constitution & bylaws"
        description="Your club's governing documents. They're public on your club page once you're approved, and the platform follows the rules they set."
      />

      {lastRejection ? (
        <Callout tone="warning" title="WSUSA didn't approve your last custom document">
          {lastRejection.note ? <p className="whitespace-pre-line">{lastRejection.note}</p> : null}
          <p className="mt-1 text-xs opacity-80">
            {lastRejection.by.name} · {fmtLongDate(lastRejection.at)}
          </p>
        </Callout>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {(["CONSTITUTION", "BYLAWS"] as const).map((kind) => {
          const d = current(kind);
          const p = pending(kind);
          return (
            <Card key={kind}>
              <CardHeader
                title={KIND_LABEL[kind]}
                description={d ? `Version ${d.version} · ${d.source === "BUILDER" ? "made with the builder" : "custom, approved by WSUSA"} · ${fmtLongDate(d.decidedAt ?? d.createdAt)}` : "Not adopted yet"}
                action={d ? <Badge tone="success">In effect</Badge> : <Badge>Missing</Badge>}
              />
              <CardBody className="space-y-3">
                {d?.fileId ? (
                  <div className="flex flex-wrap gap-2">
                    <a href={fileUrl(d.fileId)} target="_blank" rel="noopener noreferrer" className={buttonClasses("outline", "sm")}>
                      <ExternalLink className="h-4 w-4" aria-hidden /> Open PDF
                    </a>
                    <a href={fileUrl(d.fileId, true)} className={buttonClasses("ghost", "sm")}>
                      <Download className="h-4 w-4" aria-hidden /> Download
                    </a>
                  </div>
                ) : !d ? (
                  <p className="text-sm text-ink-3">{canEdit ? "Adopt one with the builder below, or upload your own for WSUSA approval." : "None on record."}</p>
                ) : null}
                {d?.contentHtml ? (
                  <details className="group rounded-lg border border-line">
                    <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-brand-600">Read it here</summary>
                    <div className="max-h-96 overflow-y-auto border-t border-line px-4 py-3 font-serif text-sm">
                      <RichContent html={d.contentHtml} />
                    </div>
                  </details>
                ) : null}
                {p ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-info-50 px-3 py-2 text-sm text-blue-900">
                    <span>
                      Custom {KIND_LABEL[kind].toLowerCase()} uploaded {fmtLongDate(p.createdAt)} is waiting for WSUSA.{" "}
                      {p.fileId ? (
                        <a href={fileUrl(p.fileId)} target="_blank" rel="noopener noreferrer" className="underline">
                          View
                        </a>
                      ) : null}
                    </span>
                    {canEdit ? <WithdrawButton docId={p.id} label={KIND_LABEL[kind].toLowerCase()} /> : null}
                  </div>
                ) : null}
              </CardBody>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader title="What your documents set" description="Wildcat Clubs applies these automatically when documents are adopted or approved." />
        <CardBody>
          <KeyValue
            items={[
              { label: "How students join", value: JOIN_LABEL[club.joinPolicy] },
              { label: "Primary way leaders are chosen", value: SUCCESSION_LABEL[club.successionMethod] },
            ]}
          />
        </CardBody>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader title="Update with the builder" description="Change sections and fill-ins, preview the PDFs, then adopt. Adopting replaces the current versions right away — no WSUSA approval needed." />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {myActiveDraft ? (
                <ButtonLink href={`/constitution/${myActiveDraft.id}?club=${club.id}`}>
                  <PenLine className="h-4 w-4" aria-hidden /> Edit the current version
                </ButtonLink>
              ) : activeBuilder?.draft ? (
                <NewDraftButton clubId={club.id} fromDraftId={activeBuilder.draft.id}>
                  Start from the current version
                </NewDraftButton>
              ) : (
                <NewDraftButton clubId={club.id}>{docs.length ? "Start a new builder draft" : "Start with the default documents"}</NewDraftButton>
              )}
              {myActiveDraft || activeBuilder?.draft ? (
                <NewDraftButton clubId={club.id} variant="outline">
                  Start fresh from the defaults
                </NewDraftButton>
              ) : null}
            </div>
            {otherDrafts.length ? (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Or adopt one of your drafts</p>
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {otherDrafts.slice(0, 5).map((d) => (
                    <li key={d.id}>
                      <Link href={`/constitution/${d.id}?club=${club.id}`} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50">
                        <FileText className="h-4 w-4 text-ink-3" aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-medium text-ink">{d.title}</span>
                        <span className="text-xs text-ink-3">edited {fmtLongDate(d.updatedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {canEdit ? (
        <Card>
          <CardHeader
            title="Upload a custom constitution or bylaws"
            description="For clubs that have outgrown the defaults. Custom documents take effect only after WSUSA approves them."
          />
          <CardBody className="space-y-4">
            <Callout tone={runningDays >= 365 ? "success" : "brand"}>
              {runningDays >= 365
                ? `Your club has been running since ${fmtLongDate(club.approvedAt!)} — a good time to tailor your documents if you need to.`
                : `We recommend sticking with the builder until your club has run for a full year${club.approvedAt ? ` (yours was approved ${fmtLongDate(club.approvedAt)})` : ""}. You can still upload now if you need to.`}
            </Callout>
            <CustomUploadForm
              clubId={club.id}
              joinPolicy={club.joinPolicy}
              successionMethod={club.successionMethod}
              pendingKinds={(["CONSTITUTION", "BYLAWS"] as const).filter((k) => pending(k))}
            />
          </CardBody>
        </Card>
      ) : null}

      <section className="space-y-3" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-semibold text-ink">
          History
        </h2>
        {docs.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Document</TH>
                <TH>Status</TH>
                <TH>Source</TH>
                <TH>By</TH>
                <TH>Date</TH>
                <TH>
                  <span className="sr-only">File</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {docs.map((d) => (
                <TR key={d.id}>
                  <TD className="font-medium">
                    {KIND_LABEL[d.kind as "CONSTITUTION"]}
                    {d.version > 0 ? ` v${d.version}` : ""}
                    {d.source === "CUSTOM_UPLOAD" && d.title ? <span className="block text-xs font-normal text-ink-3">{d.title}</span> : null}
                  </TD>
                  <TD>
                    <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                  </TD>
                  <TD className="text-ink-2">{d.source === "BUILDER" ? "Builder" : "Custom upload"}</TD>
                  <TD className="text-ink-2">{d.createdBy.name}</TD>
                  <TD className="whitespace-nowrap text-ink-2">{fmtLongDate(d.createdAt)}</TD>
                  <TD>
                    {d.fileId ? (
                      <a href={fileUrl(d.fileId)} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-600 hover:underline">
                        Open
                      </a>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-sm text-ink-3">No documents yet. Every version you adopt or upload is kept here.</p>
        )}
      </section>
    </div>
  );
}
