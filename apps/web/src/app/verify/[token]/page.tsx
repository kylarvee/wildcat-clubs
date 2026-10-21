import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getConfig } from "@/lib/config";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { verifiedRecord } from "@/lib/documents/involvement";
import { verifiedOfficers } from "@/lib/domain/officers";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/layout";
import { LogoMark } from "@/components/shell/Logo";
import { InvolvementResult } from "./_components/InvolvementResult";
import { OfficersResult } from "./_components/OfficersResult";
import { SupportLink } from "./_components/parts";

type Props = { params: Promise<{ token: string }> };

// A verification link is shared on purpose; keep it out of search engines all the same.
export const metadata: Metadata = { title: "Verify a record", robots: { index: false, follow: false } };

/**
 * /verify/[token]: the public check behind the QR code on the documents the
 * platform issues (lib/documents/tokens): a person's involvement record
 * (its summary and leadership, never the dates and events) or a club's
 * officers of record (who leads it now). A link we signed shows the record
 * as it stands today and when the document was issued; anything else says
 * plainly that the link isn't valid. No sign-in: the link is the permission.
 */
export default async function VerifyPage({ params }: Props) {
  const { token } = await params;
  // Tokens are URL-safe as issued, so the segment is used as it arrives. Each check answers only for its own kind of document.
  const [record, officers, cfg] = await Promise.all([verifiedRecord(token), verifiedOfficers(token), getConfig()]);
  const help = cfg["platform.supportEmail"];

  return (
    <Container size="md">
      <div className="mx-auto max-w-2xl space-y-6 py-4">
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-brand">{INSTITUTION.name}</p>
            <p className="text-sm text-ink-3">{PLATFORM.name} · Record verification</p>
          </div>
        </div>

        {officers.state !== "invalid" ? (
          <OfficersResult result={officers} help={help} />
        ) : record.state !== "invalid" ? (
          <InvolvementResult result={record} help={help} />
        ) : (
          <Card className="flex items-start gap-3 px-5 py-5">
            <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-danger" aria-hidden />
            <div>
              <h1 className="text-lg font-semibold text-ink">This link isn&apos;t valid</h1>
              <p className="mt-1 text-ink-2">
                It doesn&apos;t match any document {PLATFORM.name} issued. It may have been cut short or changed when it was copied. Scan the QR code on the document again, or
                ask whoever gave it to you for a fresh copy. Questions? Email {INSTITUTION.studentGovernment} at <SupportLink email={help} />.
              </p>
            </div>
          </Card>
        )}

        <p className="text-xs text-ink-3">
          <Link href="/" className="hover:text-ink hover:underline">
            {PLATFORM.name}
          </Link>{" "}
          is {INSTITUTION.name}&apos;s platform for student clubs and organizations.
        </p>
      </div>
    </Container>
  );
}
