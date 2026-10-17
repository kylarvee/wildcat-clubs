import "server-only";
import { JWT } from "google-auth-library";
import type { ClubStatus } from "@prisma/client";

/**
 * Google Workspace access for Calendar, Drive, Chat and Gmail.
 * Uses one service account with domain-wide delegation (set up once by WSU's
 * Workspace admin). Calls run "as" a Workspace user — usually the club's own
 * Google account (Club.contactEmail, see clubGoogleAccount) or the platform's
 * sender address.
 *
 * Env: GOOGLE_SERVICE_ACCOUNT_JSON = the service account key JSON (one line).
 */
export function googleJwt(subject: string, scopes: string[]): JWT {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  const key = JSON.parse(raw) as { client_email: string; private_key: string };
  return new JWT({ email: key.client_email, key: key.private_key, scopes, subject });
}

export const PLATFORM_SENDER = process.env.PLATFORM_SENDER_EMAIL ?? "clubs@weber.edu";

/** Select these on a club to pass it to clubGoogleAccount. */
export const CLUB_ACCOUNT_FIELDS = { status: true, contactEmail: true, googleAccountVerifiedAt: true } as const;

type ClubAccountFields = { status: ClubStatus; contactEmail: string | null; googleAccountVerifiedAt: Date | null };

/**
 * The Workspace user a club's Drive, Calendar and Chat sync may run as, or why
 * none. Delegation can act as anyone in the domain and club leaders type the
 * address, so every adapter asks here first: only approved clubs, and only
 * once WSUSA has verified the address is the club's own account
 * (Club.googleAccountVerifiedAt; changing the address clears it).
 */
export function clubGoogleAccount(club: ClubAccountFields | null): { email: string; reason?: undefined } | { email: null; reason: string } {
  if (!club) return { email: null, reason: "Club not found." };
  if (club.status !== "APPROVED") return { email: null, reason: "Google sync starts once WSUSA approves the club." };
  if (!club.contactEmail) return { email: null, reason: "Add the club's Google account email in club settings to turn on Google sync." };
  if (!club.googleAccountVerifiedAt) return { email: null, reason: "Google sync starts once WSUSA verifies the club's Google account." };
  return { email: club.contactEmail };
}
