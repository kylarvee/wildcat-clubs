import type { Metadata } from "next";
import { TestsHome } from "@/components/tests/TestsHome";
import { requireTestAdmin, testScopeFor } from "./guard";

export const metadata: Metadata = { title: "Tests" };

/** WSUSA's university tests: officer policy tests, refreshers, campus-wide checks. */
export default async function AdminTestsPage() {
  const user = await requireTestAdmin("/admin/tests");
  return <TestsHome scope={await testScopeFor(user)} />;
}
