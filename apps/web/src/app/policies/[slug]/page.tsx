import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { policyBySlug } from "@/lib/domain/policies";
import { fmtLongDate } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Callout, Container } from "@/components/ui/layout";
import { RichContent } from "@/components/rich/RichContent";
import { DocumentPreview } from "@/components/embeds/DocumentPreview";
import { PLACEMENT_LABEL, POLICY_STATUS_LABEL } from "@/components/policies/placements";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const p = await policyBySlug(await getCurrentUser(), slug);
  return p ? { title: p.title, description: p.summary } : { title: "Policy" };
}

/** One policy, readable by anyone: the text (or the uploaded document), its version and dates. */
export default async function PolicyPage({ params }: { params: Params }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const p = await policyBySlug(user, slug);
  if (!p) notFound();
  const admin = can(user, "admin.policies");
  const applies = p.placements.filter((x) => x !== "GENERAL");

  return (
    <Container size="md">
      <Link href="/policies" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Policy library
      </Link>

      {p.status !== "PUBLISHED" ? (
        <Callout tone="warning" className="mb-6" title={`${POLICY_STATUS_LABEL[p.status]} — only administrators can see this`}>
          {p.status === "DRAFT" ? "Publish it from the policy editor to put it in the library." : "It's archived, so it's no longer in the library or the app."}
        </Callout>
      ) : null}

      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{p.title}</h1>
          {admin ? (
            <ButtonLink href={`/admin/policies/${p.id}`} variant="outline" size="sm">
              <Pencil className="h-4 w-4" aria-hidden /> Edit
            </ButtonLink>
          ) : null}
        </div>
        <p className="mt-2 text-lg text-ink-2">{p.summary}</p>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex gap-1.5">
            <dt className="text-ink-3">Version</dt>
            <dd className="font-medium text-ink">{p.version}</dd>
          </div>
          {p.effectiveAt ? (
            <div className="flex gap-1.5">
              <dt className="text-ink-3">Effective</dt>
              <dd className="font-medium text-ink">{fmtLongDate(p.effectiveAt)}</dd>
            </div>
          ) : null}
          <div className="flex gap-1.5">
            <dt className="text-ink-3">Last updated</dt>
            <dd className="font-medium text-ink">{fmtLongDate(p.updatedAt)}</dd>
          </div>
        </dl>
        {applies.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-sm text-ink-3">Applies to:</span>
            {applies.map((a) => (
              <Badge key={a} tone="brand">
                {PLACEMENT_LABEL[a]}
              </Badge>
            ))}
          </div>
        ) : null}
      </header>

      {p.documentFile ? (
        <DocumentPreview fileId={p.documentFile.id} name={p.documentFile.name} mimeType={p.documentFile.mimeType} sizeBytes={p.documentFile.sizeBytes} height={720} />
      ) : (
        <Card>
          <CardBody className="py-6">
            <RichContent html={p.bodyHtml} />
          </CardBody>
        </Card>
      )}

      <p className="mt-8 text-sm text-ink-3">
        Questions about this policy? Contact the WSUSA office, or{" "}
        <Link href="/report" className="font-medium text-brand-600 hover:underline">
          report a concern
        </Link>
        .
      </p>
    </Container>
  );
}
