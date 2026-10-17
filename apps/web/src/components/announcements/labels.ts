import type { AnnouncementAudience } from "@prisma/client";
import { INSTITUTION } from "@/lib/institution";

/** Client-safe announcement rules and wording, shared by the domain and the composer. */

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const AUDIENCES: AnnouncementAudience[] = ["PUBLIC", "MEMBERS", "LEADERS"];

export type AnnouncementScope = "club" | "university";

/** Short badge text. Public posts carry no badge on club pages, since anyone can see them. */
export const AUDIENCE_BADGE: Record<AnnouncementScope, Record<AnnouncementAudience, string>> = {
  club: { PUBLIC: "Public", MEMBERS: "Members only", LEADERS: "Leaders only" },
  university: { PUBLIC: "Everyone", MEMBERS: "Signed-in students & staff", LEADERS: "Club leaders" },
};

export function audienceOptions(scope: AnnouncementScope, clubName?: string): { value: AnnouncementAudience; label: string; description: string }[] {
  if (scope === "club") {
    return [
      { value: "MEMBERS", label: "Members", description: `Everyone in ${clubName ?? "the club"}: members, officers and advisors.` },
      { value: "PUBLIC", label: "Public", description: "Anyone, including visitors. It also shows on the public club page. Members are notified." },
      { value: "LEADERS", label: "Leaders only", description: "Officers, ambassadors, the president, VPs and advisors." },
    ];
  }
  return [
    { value: "PUBLIC", label: "Everyone", description: `Anyone, including people who aren't signed in (the ${INSTITUTION.shortName} landing page). Every signed-in account is notified.` },
    { value: "MEMBERS", label: "Signed-in students & staff", description: `Everyone with a ${INSTITUTION.shortName} account on the platform.` },
    { value: "LEADERS", label: "Club leaders", description: "Current presidents, VPs, officers, ambassadors and advisors of every club." },
  ];
}
