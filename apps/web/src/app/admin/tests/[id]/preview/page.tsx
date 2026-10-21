import type { Metadata } from "next";
import { testOrFormTitle } from "@/lib/tests/queries";
import { TestPreviewView } from "@/components/tests/TestManageViews";
import { requireTestAdmin, testScopeFor } from "../../guard";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: await testOrFormTitle((await params).id, "Preview test", "Preview form") };
}

export default async function AdminTestPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireTestAdmin(`/admin/tests/${id}/preview`);
  return <TestPreviewView scope={await testScopeFor(user)} testId={id} />;
}
