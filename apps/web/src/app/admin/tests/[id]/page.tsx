import type { Metadata } from "next";
import { TestEditorView } from "@/components/tests/TestManageViews";
import { universityScope } from "@/components/tests/scope";
import { requireTestAdmin } from "../guard";

export const metadata: Metadata = { title: "Test builder" };

export default async function AdminTestEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireTestAdmin(`/admin/tests/${id}`);
  return <TestEditorView scope={universityScope()} testId={id} />;
}
