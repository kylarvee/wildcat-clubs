import type { Metadata } from "next";
import { requirementTargets } from "@/lib/domain/requirements";
import { PageHeader } from "@/components/ui/layout";
import { RequirementForm } from "../RequirementForm";
import { requireRequirementAdmin } from "../guard";

export const metadata: Metadata = { title: "New officer requirement" };

export default async function NewRequirementPage() {
  await requireRequirementAdmin("/admin/requirements/new");
  const { tests, events } = await requirementTargets();
  return (
    <div>
      <PageHeader breadcrumbs={[{ href: "/admin/requirements", label: "Requirements" }, { label: "New" }]} title="New requirement" />
      <RequirementForm
        id={null}
        tests={tests}
        events={events}
        initial={{ name: "", description: "", kind: "TEST", testId: "", trainingEventId: "", appliesTo: ["OFFICER", "VP", "PRESIDENT"], renewal: "ACADEMIC_YEAR", graceDays: 30, active: true }}
      />
    </div>
  );
}
