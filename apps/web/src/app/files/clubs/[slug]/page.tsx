import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadVisibleClub } from "@/lib/clubs/context";
import { initialListing } from "@/lib/files/initial";
import { Callout, Container, PageHeader } from "@/components/ui/layout";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { FileExplorer } from "@/components/files/FileExplorer";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const { club } = await loadVisibleClub(slug);
  return { title: `${club.name} files` };
}

/**
 * A club's files as members (and visitors) see them: read-only, showing only
 * what each person may open. Leaders are sent to the club workspace, where
 * the same explorer has every tool.
 */
export default async function ClubFilesForMembersPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { club, user, access } = await loadVisibleClub(slug);

  if (access?.isLeader) {
    const keep = new URLSearchParams();
    for (const k of ["folder", "view", "q"]) {
      const v = sp[k];
      const s = Array.isArray(v) ? v[0] : v;
      if (s) keep.set(k, s);
    }
    redirect(`/clubs/${club.slug}/manage/files${keep.size ? `?${keep}` : ""}`);
  }

  const base = `/files/clubs/${club.slug}`;
  const { initial, missing } = await initialListing(user, { kind: "club", clubId: club.id }, sp, base);

  const note = !user ? (
    <>
      You&apos;re seeing {club.name}&apos;s public files.{" "}
      <Link href={`/login?next=${encodeURIComponent(base)}`} className="font-medium underline">
        Sign in
      </Link>{" "}
      with your Weber State account to see what&apos;s shared with members.
    </>
  ) : !access?.isMember ? (
    <>You&apos;re seeing the files {club.name} shares publicly or with you by name. Members see more once they join.</>
  ) : null;

  return (
    <Container size="xl" className="space-y-6">
      <PageHeader
        title="Files"
        description={`What ${club.name} shares with its members: meeting minutes, flyers, resources and more.`}
        breadcrumbs={[
          { href: "/clubs", label: "Clubs" },
          { href: `/clubs/${club.slug}`, label: club.name },
          { label: "Files" },
        ]}
      />
      {missing ? (
        <Callout tone="warning" title="That folder isn't available">
          It may have been moved, deleted or made private. Here&apos;s the top of {club.name}&apos;s files instead.
        </Callout>
      ) : null}
      <FileExplorer scope={{ kind: "club", clubId: club.id }} initial={initial} folderLinkBase={base} readOnlyNote={note} />
      <PolicyNotices placement="FILES" />
    </Container>
  );
}
