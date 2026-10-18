import type { Metadata } from "next";
import { testOrFormTitle } from "@/lib/tests/queries";
import { TestPreviewView } from "@/components/tests/TestManageViews";
import { clubTestsAccess } from "../../guard";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: await testOrFormTitle((await params).id, "Preview test", "Preview form") };
}

export default async function ClubTestPreviewPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const a = await clubTestsAccess(slug);
  if (!a.ok) return a.view;
  return <TestPreviewView scope={a.scope} testId={id} />;
}
