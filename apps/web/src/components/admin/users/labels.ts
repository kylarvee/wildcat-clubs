import type { MembershipSource, MembershipStatus, PlatformRole, UserKind, UserStatus } from "@prisma/client";
import type { Tone } from "@/components/ui/badge";

/** Wording for People (admin.users) and Administrators (system). Client-safe. */

export const KIND_LABEL: Record<UserKind, string> = { STUDENT: "Student", FACULTY_STAFF: "Faculty & staff" };

export const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = { USER: "No platform role", ADMIN: "Administrator", SYSADMIN: "System administrator" };

export const USER_STATUS_LABEL: Record<UserStatus, string> = { ACTIVE: "Active", ALUMNI: "Alumni", DEACTIVATED: "Deactivated" };
export const USER_STATUS_TONE: Record<UserStatus, Tone> = { ACTIVE: "success", ALUMNI: "info", DEACTIVATED: "danger" };

export const MEMBERSHIP_STATUS_LABEL: Record<MembershipStatus, string> = {
  PENDING: "Request pending",
  ACTIVE: "Member",
  DECLINED: "Request declined",
  LEFT: "Left",
  REMOVED: "Removed",
  ALUMNI: "Alumni",
};
export const MEMBERSHIP_STATUS_TONE: Record<MembershipStatus, Tone> = {
  PENDING: "warning",
  ACTIVE: "success",
  DECLINED: "neutral",
  LEFT: "neutral",
  REMOVED: "danger",
  ALUMNI: "info",
};

export const MEMBERSHIP_SOURCE_LABEL: Record<MembershipSource, string> = {
  REGISTER: "Registered",
  CHECKIN: "Joined at a check-in",
  FOUNDER: "Founder",
  ADVISOR: "Advisor",
  IMPORT: "Imported roster",
};

/** An activity row's action in words ("Assigned a role"), from the one action catalog (lib/lake/actions). */
export { actionLabel as activityLabel } from "@/lib/lake/actions";
