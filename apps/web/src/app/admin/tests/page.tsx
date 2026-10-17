import type { Metadata } from "next";
import { TestsHome } from "@/components/tests/TestsHome";
import { universityScope } from "@/components/tests/scope";
import { requireTestAdmin } from "./guard";

export const metadata: Metadata = { title: "Tests" };

/** WSUSA's university tests: officer policy tests, refreshers, campus-wide checks. */
export default async function AdminTestsPage() {
  await requireTestAdmin("/admin/tests");
  return <TestsHome scope={universityScope()} />;
}
