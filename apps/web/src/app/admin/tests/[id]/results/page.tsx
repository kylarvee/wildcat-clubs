import type { Metadata } from "next";
import { TestResultsView } from "@/components/tests/TestManageViews";
import { universityScope } from "@/components/tests/scope";
import { requireTestAdmin } from "../../guard";

export const metadata: Metadata = { title: "Test results" };

export default async function AdminTestResultsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cycle?: string | string[] }> }) {
  const { id } = await params;
  const sp = await searchParams;
  await requireTestAdmin(`/admin/tests/${id}/results`);
  const cycle = Array.isArray(sp.cycle) ? sp.cycle[0] : sp.cycle;
  return <TestResultsView scope={universityScope()} testId={id} cycleParam={cycle} />;
}
