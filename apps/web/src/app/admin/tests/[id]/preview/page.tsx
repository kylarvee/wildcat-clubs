import type { Metadata } from "next";
import { testOrFormTitle } from "@/lib/tests/queries";
import { TestPreviewView } from "@/components/tests/TestManageViews";
import { universityScope } from "@/components/tests/scope";
import { requireTestAdmin } from "../../guard";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: await testOrFormTitle((await params).id, "Preview test", "Preview form") };
}

export default async function AdminTestPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireTestAdmin(`/admin/tests/${id}/preview`);
  return <TestPreviewView scope={universityScope()} testId={id} />;
}
