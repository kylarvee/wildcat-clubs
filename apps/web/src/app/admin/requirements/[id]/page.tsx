import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CAPABILITIES } from "@/lib/authz";
import { requirementForAdmin, requirementTargets } from "@/lib/domain/requirements";
import { PageHeader } from "@/components/ui/layout";
import { RequirementForm } from "../RequirementForm";
import { requireRequirementAdmin } from "../guard";

export const metadata: Metadata = { title: "Edit requirement" };

export default async function EditRequirementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRequirementAdmin(`/admin/requirements/${id}`);
  // Another office's requirement isn't this person's to open.
  const [r, targets] = await Promise.all([requirementForAdmin(user, id), requirementTargets(user)]);
  if (!r) notFound();
  return (
    <div>
      <PageHeader breadcrumbs={[{ href: "/admin/requirements", label: "Requirements" }, { label: r.name }]} title={r.name} />
      <RequirementForm
        id={r.id}
        tests={targets.tests}
        events={targets.events}
        offices={targets.offices}
        umbrella={targets.umbrella}
        permissions={Object.entries(CAPABILITIES).map(([value, c]) => ({ value, label: c.label }))}
        initial={{
          name: r.name,
          description: r.description ?? "",
          kind: r.kind,
          testId: r.testId ?? "",
          trainingEventId: r.trainingEventId ?? "",
          appliesTo: r.appliesTo,
          renewal: r.renewal,
          graceDays: r.graceDays,
          active: r.active,
          gatesCapability: r.gatesCapability ?? "",
          officeId: r.officeId ?? "",
        }}
      />
    </div>
  );
}
