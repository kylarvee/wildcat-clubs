import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/kit";
import { adoptableClubs, clubFacts, loadOwnDraft } from "@/lib/domain/constitution";
import { Container, PageHeader } from "@/components/ui/layout";
import { ConstitutionEditor, type EditorClub } from "@/components/constitution/ConstitutionEditor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [user, draft] = await Promise.all([getCurrentUser(), db.constitutionDraft.findUnique({ where: { id: (await params).id }, select: { title: true, ownerId: true } })]);
  return { title: draft && user?.id === draft.ownerId ? draft.title : "Constitution draft" };
}

export default async function ConstitutionDraftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ club?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser(`/constitution/${id}`);
  const draft = await loadOwnDraft(user, id).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const clubs = await adoptableClubs(user, sp.club ?? null);
  const focusClubId = sp.club && clubs.some((c) => c.id === sp.club) ? sp.club : null;
  const editorClubs: EditorClub[] = await Promise.all(clubs.map(async (c) => ({ ...c, facts: await clubFacts(c.id) })));
  const data = { ...draft.data, previewClubId: draft.data.previewClubId ?? focusClubId };
  const focus = clubs.find((c) => c.id === focusClubId);

  return (
    <Container size="xl" className="pt-6">
      <PageHeader
        title="Constitution & bylaws"
        description="Changes save automatically. Nothing is official until you adopt it for a club."
        breadcrumbs={[
          ...(focus ? [{ href: `/clubs/${focus.slug}/manage/constitution`, label: focus.name }] : [{ href: "/constitution", label: "Constitution builder" }]),
          { label: draft.title },
        ]}
        className="mb-2"
      />
      <ConstitutionEditor draftId={draft.id} initialTitle={draft.title} initialData={data} initialSavedAt={draft.updatedAt.toISOString()} clubs={editorClubs} focusClubId={focusClubId} />
    </Container>
  );
}
