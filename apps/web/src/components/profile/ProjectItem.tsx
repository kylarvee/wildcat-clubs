import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { RichContent } from "@/components/rich/RichContent";
import { ProfileFiles } from "@/components/profile/ProfileFiles";
import { fmtMonthSpan, fmtMonthYear } from "@/lib/profiles/format";
import type { ProfileProject } from "@/lib/profiles/queries";

function linkHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** One project or role contribution: title, dates, write-up, link and files. */
export async function ProjectItem({ project, showClub = false, compact = false }: { project: ProfileProject; showClub?: boolean; compact?: boolean }) {
  const when = project.startDate ? (project.endDate ? fmtMonthSpan(project.startDate, project.endDate) : fmtMonthYear(project.startDate)) : null;
  return (
    <article className={compact ? "" : "py-4 first:pt-0 last:pb-0"}>
      <h4 className="font-medium text-ink">{project.title}</h4>
      {when || (showClub && project.club) ? (
        <p className="mt-0.5 text-xs text-ink-3">
          {when}
          {when && showClub && project.club ? " · " : null}
          {showClub && project.club ? (
            <Link href={`/clubs/${project.club.slug}`} className="hover:text-brand-600 hover:underline">
              {project.club.name}
            </Link>
          ) : null}
        </p>
      ) : null}
      {project.descriptionHtml ? <RichContent html={project.descriptionHtml} className="mt-2 text-sm" /> : null}
      {project.url ? (
        <a href={project.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{linkHost(project.url)}</span>
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
      <ProfileFiles files={project.files} hidden={project.hiddenFiles} />
    </article>
  );
}
