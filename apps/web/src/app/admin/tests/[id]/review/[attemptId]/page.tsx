import type { Metadata } from "next";
import { testOrFormTitle } from "@/lib/tests/queries";
import { TestReviewView } from "@/components/tests/TestManageViews";
import { universityScope } from "@/components/tests/scope";
import { requireTestAdmin } from "../../../guard";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: await testOrFormTitle((await params).id, "Grade an attempt", "Form response") };
}

export default async function AdminTestReviewPage({ params }: { params: Promise<{ id: string; attemptId: string }> }) {
  const { id, attemptId } = await params;
  const user = await requireTestAdmin(`/admin/tests/${id}/review/${attemptId}`);
  return <TestReviewView scope={universityScope()} testId={id} attemptId={attemptId} actor={user} />;
}
