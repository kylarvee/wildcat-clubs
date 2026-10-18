import type { ClubRole, MembershipStatus } from "@prisma/client";

/** One roster row, pre-formatted on the server (campus time) so the client only filters and sorts. */
export type MemberRow = {
  membershipId: string;
  userId: string;
  name: string;
  handle: string;
  email: string;
  avatarUrl: string | null;
  avatarColor: string;
  status: MembershipStatus;
  internalTitle: string | null;
  joinedAt: number | null;
  joinedLabel: string;
  roles: { label: string; role: ClubRole; viaClub: string | null }[];
  attended: number;
  lastAttendedAt: number | null;
  lastAttendedLabel: string;
  active: boolean;
  canRemove: boolean;
  removeBlocked?: string;
  isSelf: boolean;
  /** From their member details (lib/authz/details: roster holders and advisors see these). */
  yearLabel: string | null;
  phone: string | null;
  contactEmail: string | null;
  hasEmergency: boolean;
};

export type PendingRow = {
  membershipId: string;
  name: string;
  handle: string;
  email: string;
  avatarUrl: string | null;
  avatarColor: string;
  requestedLabel: string;
  attended: number;
};
