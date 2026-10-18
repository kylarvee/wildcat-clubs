import type { Metadata } from "next";
import { testOrFormTitle } from "@/lib/tests/queries";
import { TestReviewView } from "@/components/tests/TestManageViews";
import { clubTestsAccess } from "../../../guard";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: await testOrFormTitle((await params).id, "Grade an attempt", "Form response") };
}

export default async function ClubTestReviewPage({ params }: { params: Promise<{ slug: string; id: string; attemptId: string }> }) {
  const { slug, id, attemptId } = await params;
  const a = await clubTestsAccess(slug);
  if (!a.ok) return a.view;
  return <TestReviewView scope={a.scope} testId={id} attemptId={attemptId} actor={a.user} />;
}
