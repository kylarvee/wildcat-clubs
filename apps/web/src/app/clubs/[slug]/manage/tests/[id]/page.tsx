import type { Metadata } from "next";
import { TestEditorView } from "@/components/tests/TestManageViews";
import { clubTestsAccess } from "../guard";

export const metadata: Metadata = { title: "Test builder" };

export default async function ClubTestEditorPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const a = await clubTestsAccess(slug);
  if (!a.ok) return a.view;
  return <TestEditorView scope={a.scope} testId={id} />;
}
