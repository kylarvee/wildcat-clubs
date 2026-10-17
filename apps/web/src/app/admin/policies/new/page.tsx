import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/layout";
import { PolicyEditor } from "@/components/policies/PolicyEditor";
import { requirePolicyAdmin } from "../guard";

export const metadata: Metadata = { title: "New policy" };

export default async function NewPolicyPage() {
  await requirePolicyAdmin("/admin/policies/new");
  return (
    <div>
      <PageHeader breadcrumbs={[{ href: "/admin/policies", label: "Policies" }, { label: "New policy" }]} title="New policy" description="Save it as a draft while you work; publish when it's ready for students to see." />
      <PolicyEditor
        initial={{ id: null, title: "", slug: "", summary: "", bodyHtml: "", document: null, placements: [], status: "DRAFT", effectiveOn: "", version: 1, published: false }}
      />
    </div>
  );
}
