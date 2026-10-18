import type { MembershipSource, MembershipStatus, PlatformRole, UserKind, UserStatus } from "@prisma/client";
import type { Tone } from "@/components/ui/badge";

/** Wording for People (admin.users) and Administrators (system). Client-safe. */

export const KIND_LABEL: Record<UserKind, string> = { STUDENT: "Student", FACULTY_STAFF: "Faculty or staff" };

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

/** "attendance.checkin" → "Attendance · checkin" is unreadable; these cover what people do most. */
const ACTION_LABEL: Record<string, string> = {
  "funding.partially_approved": "Partly approved a funding request",
  "funding.withdrawn": "Withdrew a funding request",
  "funding.draft_created": "Started a funding request",
  "funding.draft_updated": "Edited a funding request draft",
  "funding.draft_discarded": "Discarded a funding request draft",
  "invoice.created": "Created a funding invoice",
  "invoice.processed": "Marked a funding invoice processed",
  "budget.item_added": "Added a budget cost",
  "budget.item_updated": "Edited a budget cost",
  "budget.item_removed": "Removed a budget cost",
  "attendance.checkin": "Checked in to an event",
  "attendance.manual_add": "Added someone to an event's attendance",
  "attendance.removed": "Removed a check-in",
  "membership.joined": "Joined a club",
  "membership.requested": "Asked to join a club",
  "membership.left": "Left a club",
  "membership.approved": "Approved a join request",
  "membership.declined": "Declined a join request",
  "membership.removed": "Removed a member",
  "review.created": "Wrote a review",
  "review.updated": "Edited a review",
  "review.flagged": "Reported a review",
  "review.hidden": "Hid a review",
  "review.restored": "Restored a review",
  "role.assigned": "Assigned a role",
  "role.ended": "Ended a role",
  "event.created": "Created an event",
  "event.drafted": "Saved an event idea",
  "cohost.approved": "Accepted a co-hosting request",
  "cohost.declined": "Declined a co-hosting request",
  "club.approved": "Approved a club",
  "club.changes_requested": "Asked a club for changes",
  "funding.approved": "Approved a funding request",
  "funding.denied": "Denied a funding request",
  "policy.published": "Published a policy",
  "election.applied": "Applied an election result",
  "advisor.invited": "Invited an advisor",
  "event.updated": "Updated an event",
  "event.cancelled": "Cancelled an event",
  "announcement.posted": "Posted an announcement",
  "club.created": "Started a club",
  "club.submitted": "Submitted a club for review",
  "club.profile_updated": "Updated a club profile",
  "funding.submitted": "Submitted a funding request",
  "test.submitted": "Took a test",
  "test.form_submitted": "Filled out a form",
  "details.updated": "Updated their member details",
  "details.confirmed": "Confirmed their member details",
  "details.emergency_viewed": "Opened a member's emergency contact",
  "user.graduated": "Marked someone graduated",
  "user.deactivated": "Deactivated an account",
  "user.reactivated": "Reactivated an account",
};

export function activityLabel(action: string): string {
  if (ACTION_LABEL[action]) return ACTION_LABEL[action];
  const [area, verb] = action.split(".");
  const words = (s: string | undefined) => (s ?? "").replace(/_/g, " ").trim();
  const text = verb ? `${words(area)}: ${words(verb)}` : words(area);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
