import type { Metadata } from "next";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { workspaceTitle } from "@/components/founding/workspaceTitle";
import { FoundingOverview } from "@/components/founding/FoundingOverview";
import { InReview, NotApproved } from "@/components/founding/InReview";
import { ClubDashboard } from "@/components/founding/ClubDashboard";
import { RetiredSummary } from "@/components/founding/RetiredSummary";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return workspaceTitle((await params).slug, "Overview");
}

/**
 * Workspace overview. One page, four lives: the founding checklist (draft /
 * changes requested), the WSUSA review panel, the running club's dashboard,
 * and the archive of a retired club.
 */
export default async function ClubOverviewPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ created?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { club, access } = await loadClubWorkspace(slug);

  switch (club.status) {
    case "DRAFT":
    case "CHANGES_REQUESTED":
      return <FoundingOverview club={club} access={access} justCreated={sp.created === "1" && club.status === "DRAFT"} />;
    case "SUBMITTED":
      return <InReview club={club} />;
    case "REJECTED":
      return <NotApproved club={club} />;
    case "RETIRED":
      return <RetiredSummary club={club} />;
    default:
      return <ClubDashboard club={club} access={access} />;
  }
}
