import { loadClubWorkspace } from "@/lib/clubs/context";
import { OrgChart } from "@/components/org-chart/OrgChart";
import { Callout } from "@/components/ui/layout";
import { ToolHeader } from "../_components/ToolHeader";

export const metadata = { title: "Org chart preview" };

/** The chart exactly as it appears on the club page (plus training notes, which only leaders see). */
export default async function OrgChartPreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await loadClubWorkspace(slug);
  return (
    <div>
      <ToolHeader slug={club.slug} clubName={club.name} officersLetter={club.status === "APPROVED"} />
      <Callout tone="info" className="mb-6">
        This is what members and visitors see on {club.name}&apos;s page. &ldquo;Training pending&rdquo; notes show only to club leaders.
      </Callout>
      <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-4 sm:p-6">
        <OrgChart clubId={club.id} />
      </div>
    </div>
  );
}
