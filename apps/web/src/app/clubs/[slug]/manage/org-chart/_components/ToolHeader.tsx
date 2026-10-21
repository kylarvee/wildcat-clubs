import type { ReactNode } from "react";
import { Download, History } from "lucide-react";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { LinkTabs } from "@/components/ui/tabs";

/**
 * Shared title + tabs for the Org Chart tool's two views. An approved club's
 * header also offers its officers of record: a one-page letter of who leads
 * it (lib/domain/officers), for a bank, a room booking or a sponsor.
 */
export function ToolHeader({ slug, clubName, actions, officersLetter = false }: { slug: string; clubName: string; actions?: ReactNode; officersLetter?: boolean }) {
  const base = `/clubs/${slug}/manage/org-chart`;
  return (
    <>
      <PageHeader
        title="Org chart"
        description={
          officersLetter
            ? `Who's responsible for what in ${clubName}. Members see this chart on the club page, so keep seats and responsibilities current. Need to show a bank, a room booking or a sponsor who leads the club? Download the officers of record.`
            : `Who's responsible for what in ${clubName}. Members see this chart on the club page, so keep seats and responsibilities current.`
        }
        actions={
          <>
            <ButtonLink href={`/clubs/${slug}/history`} variant="outline">
              <History className="h-4 w-4" aria-hidden /> Role history
            </ButtonLink>
            {officersLetter ? (
              // A plain link: the PDF comes from a route, built fresh on each download.
              <a href={`${base}/officers.pdf`} download className={buttonClasses("outline")}>
                <Download className="h-4 w-4" aria-hidden /> Download officers of record (PDF)
              </a>
            ) : null}
            {actions}
          </>
        }
      />
      <LinkTabs
        className="mb-6"
        tabs={[
          { href: base, label: "Seats & people", exact: true },
          { href: `${base}/preview`, label: "As members see it" },
        ]}
      />
    </>
  );
}
