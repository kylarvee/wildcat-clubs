import type { Metadata } from "next";
import { testOrFormTitle } from "@/lib/tests/queries";
import { TestResultsView } from "@/components/tests/TestManageViews";
import { clubTestsAccess } from "../../guard";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: await testOrFormTitle((await params).id, "Test results", "Responses") };
}

export default async function ClubTestResultsPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ cycle?: string | string[] }> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const a = await clubTestsAccess(slug);
  if (!a.ok) return a.view;
  const cycle = Array.isArray(sp.cycle) ? sp.cycle[0] : sp.cycle;
  return <TestResultsView scope={a.scope} testId={id} cycleParam={cycle} />;
}
