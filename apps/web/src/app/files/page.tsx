import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/authz";
import { initialListing } from "@/lib/files/initial";
import { Callout, Container, PageHeader } from "@/components/ui/layout";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { FileExplorer } from "@/components/files/FileExplorer";

export const metadata: Metadata = { title: "My files" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * My files: a person's own uploads (profile projects, role contributions,
 * editor uploads), plus everything shared with them by name.
 */
export default async function MyFilesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await requireUser("/files");
  const { initial, missing } = await initialListing(user, { kind: "user", userId: user.id }, sp, "/files");

  return (
    <Container size="xl" className="space-y-6">
      <PageHeader
        title="My files"
        description="Files you've uploaded for your profile projects and club work, and anything people have shared with you. You choose who can open each one."
      />
      {missing ? (
        <Callout tone="warning" title="That folder isn't available">
          It may have been moved, deleted, or it's no longer shared with you.
        </Callout>
      ) : null}
      <FileExplorer
        scope={{ kind: "user" }}
        initial={initial}
        folderLinkBase="/files"
        links={isAdmin(user) ? [{ label: "University files", href: "/files/university", icon: "university" }] : undefined}
      />
      <PolicyNotices placement="FILES" />
    </Container>
  );
}
