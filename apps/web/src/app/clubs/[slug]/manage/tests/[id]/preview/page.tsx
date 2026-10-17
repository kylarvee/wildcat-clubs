import type { Metadata } from "next";
import { TestPreviewView } from "@/components/tests/TestManageViews";
import { clubTestsAccess } from "../../guard";

export const metadata: Metadata = { title: "Preview test" };

export default async function ClubTestPreviewPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const a = await clubTestsAccess(slug);
  if (!a.ok) return a.view;
  return <TestPreviewView scope={a.scope} testId={id} />;
}
