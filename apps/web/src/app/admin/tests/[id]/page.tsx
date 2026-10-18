import type { Metadata } from "next";
import { testOrFormTitle } from "@/lib/tests/queries";
import { TestEditorView } from "@/components/tests/TestManageViews";
import { universityScope } from "@/components/tests/scope";
import { requireTestAdmin } from "../guard";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: await testOrFormTitle((await params).id, "Test builder", "Form builder") };
}

export default async function AdminTestEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireTestAdmin(`/admin/tests/${id}`);
  return <TestEditorView scope={universityScope()} testId={id} />;
}
