import type { Metadata } from "next";
import { testOrFormTitle } from "@/lib/tests/queries";
import { TestEditorView } from "@/components/tests/TestManageViews";
import { clubTestsAccess } from "../guard";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: await testOrFormTitle((await params).id, "Test builder", "Form builder") };
}

export default async function ClubTestEditorPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const a = await clubTestsAccess(slug);
  if (!a.ok) return a.view;
  return <TestEditorView scope={a.scope} testId={id} />;
}
