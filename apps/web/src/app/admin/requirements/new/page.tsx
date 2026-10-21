import type { Metadata } from "next";
import { CAPABILITIES } from "@/lib/authz";
import { requirementTargets } from "@/lib/domain/requirements";
import { PageHeader } from "@/components/ui/layout";
import { RequirementForm } from "../RequirementForm";
import { requireRequirementAdmin } from "../guard";

export const metadata: Metadata = { title: "New requirement" };

export default async function NewRequirementPage() {
  const user = await requireRequirementAdmin("/admin/requirements/new");
  const { tests, events, offices, umbrella } = await requirementTargets(user);
  return (
    <div>
      <PageHeader breadcrumbs={[{ href: "/admin/requirements", label: "Requirements" }, { label: "New" }]} title="New requirement" />
      <RequirementForm
        id={null}
        tests={tests}
        events={events}
        offices={offices}
        umbrella={umbrella}
        permissions={Object.entries(CAPABILITIES).map(([value, c]) => ({ value, label: c.label }))}
        initial={{
          name: "",
          description: "",
          kind: "TEST",
          testId: "",
          trainingEventId: "",
          appliesTo: ["OFFICER", "VP", "PRESIDENT"],
          renewal: "ACADEMIC_YEAR",
          graceDays: 30,
          active: true,
          gatesCapability: "",
          // An office's staff file their own office's; WSUSA's admins start with WSUSA's.
          officeId: umbrella ? "" : (offices[0]?.id ?? ""),
        }}
      />
    </div>
  );
}
