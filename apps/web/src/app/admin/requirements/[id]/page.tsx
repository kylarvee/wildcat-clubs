import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirementTargets } from "@/lib/domain/requirements";
import { PageHeader } from "@/components/ui/layout";
import { RequirementForm } from "../RequirementForm";
import { requireRequirementAdmin } from "../guard";

export const metadata: Metadata = { title: "Edit officer requirement" };

export default async function EditRequirementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRequirementAdmin(`/admin/requirements/${id}`);
  const [r, targets] = await Promise.all([db.roleRequirement.findUnique({ where: { id } }), requirementTargets()]);
  if (!r) notFound();
  return (
    <div>
      <PageHeader breadcrumbs={[{ href: "/admin/requirements", label: "Officer requirements" }, { label: r.name }]} title={r.name} />
      <RequirementForm
        id={r.id}
        tests={targets.tests}
        events={targets.events}
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
        }}
      />
    </div>
  );
}
