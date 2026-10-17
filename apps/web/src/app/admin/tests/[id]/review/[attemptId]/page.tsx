import type { Metadata } from "next";
import { TestReviewView } from "@/components/tests/TestManageViews";
import { universityScope } from "@/components/tests/scope";
import { requireTestAdmin } from "../../../guard";

export const metadata: Metadata = { title: "Grade an attempt" };

export default async function AdminTestReviewPage({ params }: { params: Promise<{ id: string; attemptId: string }> }) {
  const { id, attemptId } = await params;
  const user = await requireTestAdmin(`/admin/tests/${id}/review/${attemptId}`);
  return <TestReviewView scope={universityScope()} testId={id} attemptId={attemptId} actor={user} />;
}
