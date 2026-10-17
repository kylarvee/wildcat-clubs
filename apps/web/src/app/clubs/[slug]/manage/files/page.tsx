import type { Metadata } from "next";
import Link from "next/link";
import { Cloud, HardDrive } from "lucide-react";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { prepareClubFiles } from "@/lib/domain/files";
import { initialListing } from "@/lib/files/initial";
import { driveReady } from "@/lib/integrations/google-drive";
import { Callout, PageHeader } from "@/components/ui/layout";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { FileExplorer } from "@/components/files/FileExplorer";

export const metadata: Metadata = { title: "Club files" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Club Files: the club's shared drive. Every leader can browse what their
 * role may see; the "files" capability adds uploading, organizing, sharing
 * and featuring files on the club page. Members use /files/clubs/[slug].
 */
export default async function ClubFilesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { user, club, access } = await loadClubWorkspace(slug);
  const base = `/clubs/${club.slug}/manage/files`;

  // The default folders are made the first time anyone opens Files.
  await prepareClubFiles(club.id);
  const [{ initial, missing }, drive] = await Promise.all([initialListing(user, { kind: "club", clubId: club.id }, sp, base), driveReady(club.id)]);

  const canManage = access.capabilities.has("files");
  const readOnly = club.status === "RETIRED" || club.status === "REJECTED";
  const readOnlyNote = readOnly ? (
    <>This club is {club.status === "RETIRED" ? "retired" : "closed"}, so its files are kept as they are. You can still open and download them.</>
  ) : !canManage ? (
    access.suspended ? (
      <>
        Your leadership permissions are paused until you finish your required training or test, so you can open files but not change them. Check{" "}
        <Link href="/tasks" className="underline">
          your tasks
        </Link>
        .
      </>
    ) : (
      <>You can open the files your role allows. Uploading and organizing needs the Files permission. Ask your president or advisor to add it to your role.</>
    )
  ) : null;

  const sidebarNote =
    drive.state === "live" ? (
      <span className="flex items-start gap-1.5">
        <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        <span>
          Copied to the club&apos;s Google Drive (<span className="break-all">{drive.account}</span>). Make changes here so everyone sees them.
        </span>
      </span>
    ) : drive.state === "needs-account" && canManage ? (
      <span className="flex items-start gap-1.5">
        <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Add the club&apos;s Google account in{" "}
          <Link href={`/clubs/${club.slug}/manage/settings`} className="font-medium text-brand-600 hover:underline">
            Settings
          </Link>{" "}
          to keep a copy in Google Drive.
        </span>
      </span>
    ) : drive.state === "pending" && canManage ? (
      // An account is set, but the club isn't approved yet or WSUSA hasn't verified the account.
      <span className="flex items-start gap-1.5">
        <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{drive.reason ?? "Google Drive copies start once WSUSA approves the club and verifies its Google account."}</span>
      </span>
    ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Files"
        description={`Everything ${club.name} keeps in one place: meeting minutes, flyers, resources and officer notes. Right-click anything (or long-press on a phone) for more options.`}
      />
      {missing ? (
        <Callout tone="warning" title="That folder isn't available">
          It may have been moved, deleted or made private. Here&apos;s the top of {club.name}&apos;s files instead.
        </Callout>
      ) : null}
      <FileExplorer scope={{ kind: "club", clubId: club.id }} initial={initial} folderLinkBase={`/files/clubs/${club.slug}`} readOnlyNote={readOnlyNote} sidebarNote={sidebarNote} />
      <PolicyNotices placement="FILES" />
    </div>
  );
}
