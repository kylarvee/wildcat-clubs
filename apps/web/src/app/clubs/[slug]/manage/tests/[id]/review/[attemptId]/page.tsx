import type { Metadata } from "next";
import { TestReviewView } from "@/components/tests/TestManageViews";
import { clubTestsAccess } from "../../../guard";

export const metadata: Metadata = { title: "Grade an attempt" };

export default async function ClubTestReviewPage({ params }: { params: Promise<{ slug: string; id: string; attemptId: string }> }) {
  const { slug, id, attemptId } = await params;
  const a = await clubTestsAccess(slug);
  if (!a.ok) return a.view;
  return <TestReviewView scope={a.scope} testId={id} attemptId={attemptId} actor={a.user} />;
}
