import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/authz";
import { initialListing } from "@/lib/files/initial";
import { Callout, Container, PageHeader } from "@/components/ui/layout";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { FileExplorer } from "@/components/files/FileExplorer";

export const metadata: Metadata = { title: "University files" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** University files (no club, no owner): policy documents, test materials and other WSUSA files. Admins only. */
export default async function UniversityFilesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await requireUser("/files/university");
  if (!isAdmin(user)) notFound();
  const { initial, missing } = await initialListing(user, { kind: "university" }, sp, "/files/university");

  return (
    <Container size="xl" className="space-y-6">
      <PageHeader
        title="University files"
        description="Policy documents, test materials and other files WSUSA shares across every club. Set each one to Public, Weber State accounts, or administrators only."
        breadcrumbs={[{ href: "/admin", label: "Admin" }, { label: "University files" }]}
      />
      {missing ? (
        <Callout tone="warning" title="That folder isn't available">
          It may have been moved or deleted. Here are the top-level university files instead.
        </Callout>
      ) : null}
      <FileExplorer scope={{ kind: "university" }} initial={initial} folderLinkBase="/files/university" links={[{ label: "My files", href: "/files", icon: "home" }]} />
      <PolicyNotices placement="FILES" />
    </Container>
  );
}
