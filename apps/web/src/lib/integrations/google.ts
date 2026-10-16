import "server-only";
import { JWT } from "google-auth-library";

/**
 * Google Workspace access for Calendar, Drive, Chat and Gmail.
 * Uses one service account with domain-wide delegation (set up once by WSU's
 * Workspace admin). Calls run "as" a Workspace user — usually the club's own
 * Google account (Club.contactEmail) or the platform's sender address.
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
