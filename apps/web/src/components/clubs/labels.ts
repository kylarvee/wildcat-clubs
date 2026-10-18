import type { EventKind } from "@prisma/client";

/**
 * Plain-language labels for club fields. Shared by server pages and client
 * filters, so this module must stay free of server-only imports. The club
 * field labels live in lib/labels/clubs and are re-exported here for the code
 * that has always imported them from this file.
 */

export {
  CLUB_CATEGORIES,
  CLUB_CATEGORY_LABEL,
  CLUB_SCOPE_LABEL,
  CLUB_SCOPES,
  CLUB_STATUS_LABEL,
  CLUB_STATUS_TONE,
  CLUB_TYPE_HINT,
  CLUB_TYPE_LABEL,
  CLUB_TYPE_TONE,
  CLUB_TYPES,
  JOIN_POLICY_LABEL,
  JOIN_POLICY_SHORT,
  STANDING_HINT,
  STANDING_LABEL,
  STANDING_TONE,
  standingOf,
  type ClubStanding,
} from "@/lib/labels/clubs";

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  MEETING: "Meeting",
  PRACTICE: "Practice",
  SOCIAL: "Social",
  WORKSHOP: "Workshop",
  SERVICE: "Service",
  COMPETITION: "Competition",
  FUNDRAISER: "Fundraiser",
  TRAINING: "Training",
  OTHER: "Event",
};

/** Club colors come from the database; only trust a plain 6-digit hex in inline styles. */
export function safeHex(color: string | null | undefined, fallback = "#492365") {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

export function pct(rate: number | null | undefined) {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}


export const SOCIAL_PLATFORMS = ["instagram", "facebook", "x", "tiktok", "discord", "linkedin", "youtube", "other"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type SocialLink = { platform: SocialPlatform; url: string };

export const SOCIAL_LABEL: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X (Twitter)",
  tiktok: "TikTok",
  discord: "Discord",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  other: "Other link",
};

/** Social links stored on a club, read defensively (the column is JSON). */
export function readSocialLinks(raw: unknown): SocialLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is SocialLink => Boolean(x) && typeof x === "object" && typeof (x as SocialLink).url === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes((x as SocialLink).platform))
    .slice(0, 8);
}
