import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { Container, PageHeader } from "@/components/ui/layout";
import { StatusLookup } from "@/app/report/_components/StatusLookup";

export const metadata: Metadata = { title: "Check a report's status" };

export default async function ReportStatusPage() {
  await requireUser("/report/status");
  return (
    <Container size="md">
      <PageHeader
        title="Check a report's status"
        description="Enter the case code you got when you sent your report. You'll see where it stands and when it last changed — administrators' notes stay private."
        breadcrumbs={[{ href: "/report", label: "Report a concern" }, { label: "Check status" }]}
      />
      <StatusLookup />
      <p className="mt-6 text-sm text-ink-3">
        Lost an anonymous report&rsquo;s code? We can&rsquo;t look it up, because it isn&rsquo;t linked to you. You can{" "}
        <Link href="/report" className="text-brand-600 underline-offset-2 hover:underline">
          send a new report
        </Link>{" "}
        that mentions the first one.
      </p>
    </Container>
  );
}
