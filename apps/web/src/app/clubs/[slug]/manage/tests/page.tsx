import type { Metadata } from "next";
import { TestsHome } from "@/components/tests/TestsHome";
import { clubTestsAccess } from "./guard";

export const metadata: Metadata = { title: "Club tests" };

export default async function ClubTestsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await clubTestsAccess(slug);
  if (!a.ok) return a.view;
  return <TestsHome scope={a.scope} />;
}
