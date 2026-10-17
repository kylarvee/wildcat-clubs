import type { Metadata } from "next";
import { TestPreviewView } from "@/components/tests/TestManageViews";
import { universityScope } from "@/components/tests/scope";
import { requireTestAdmin } from "../../guard";

export const metadata: Metadata = { title: "Preview test" };

export default async function AdminTestPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireTestAdmin(`/admin/tests/${id}/preview`);
  return <TestPreviewView scope={universityScope()} testId={id} />;
}
