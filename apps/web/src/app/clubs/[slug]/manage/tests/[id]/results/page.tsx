import type { Metadata } from "next";
import { TestResultsView } from "@/components/tests/TestManageViews";
import { clubTestsAccess } from "../../guard";

export const metadata: Metadata = { title: "Test results" };

export default async function ClubTestResultsPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ cycle?: string | string[] }> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const a = await clubTestsAccess(slug);
  if (!a.ok) return a.view;
  const cycle = Array.isArray(sp.cycle) ? sp.cycle[0] : sp.cycle;
  return <TestResultsView scope={a.scope} testId={id} cycleParam={cycle} />;
}
