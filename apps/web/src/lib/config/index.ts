import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

/**
 * System configuration — the one place platform-wide rules live.
 * Only sysadmins change these (see setConfig). Every rule that the spec calls
 * "configurable by an admin" or "set by the system admin" is a key here.
 */
export const CONFIG_DEFAULTS = {
  /** A student counts as active in a club if they attended within this many days… */
  "activity.studentWindowDays": 31,
  /** …or attended at least one of the club's last N events. */
  "activity.studentRecentEvents": 2,
  /** A club needs at least this many held events in the current or previous term… */
  "activity.clubMinEvents": 2,
  /** …and at least this many registered members (waived during the pilot period). */
  "activity.clubMinMembers": 8,

  /** Uniform across the platform: events attended before a student may review a club. */
  "reviews.minAttendance": 3,
  /** Possible review bombing: this many low ratings inside the window opens an admin task. */
  "reviews.bombingCount": 3,
  "reviews.bombingMaxRating": 2,
  "reviews.bombingWindowHours": 48,

  /** Check-in opens this many minutes before an occurrence starts and closes this many after it ends. */
  "checkin.opensMinutesBefore": 30,
  "checkin.closesMinutesAfter": 30,
  /** The on-screen QR code changes this often, so a photo of it stops working. */
  "checkin.qrRotateSeconds": 30,

  /** Claude features. Off until the university has API access. */
  "ai.assistantEnabled": false,
  "ai.gradingEnabled": false,

  /** Google Workspace sync. Off = the platform keeps working on its own data (mock mode). */
  "integrations.googleCalendar": false,
  "integrations.googleDrive": false,
  "integrations.googleChat": false,
  "integrations.email": false,
  "integrations.push": false,

  /**
   * Shown to founders after they submit a club for review.
   * PLACEHOLDER contact details — a sysadmin must confirm them with WSUSA before launch.
   */
  "wsusa.office": {
    name: "WSUSA Clubs & Organizations",
    location: "Shepherd Union Building, Student Involvement & Leadership offices",
    hours: "Monday–Friday, 8 a.m.–5 p.m.",
    email: "wsusa-clubs@weber.edu",
    phone: "",
    reviewDays: 10,
  },
  "wsusa.reviewers": [
    { name: "Clubs & Orgs Coordinator", title: "WSUSA Clubs & Organizations", email: "wsusa-clubs@weber.edu" },
  ] as { name: string; title: string; email: string }[],

  /** Mobile app store links shown in the "get the app" prompt. */
  "app.iosUrl": "",
  "app.androidUrl": "",
} as const;

export type ConfigKey = keyof typeof CONFIG_DEFAULTS;
export type Config = { -readonly [K in ConfigKey]: Widen<(typeof CONFIG_DEFAULTS)[K]> };
type Widen<T> = T extends boolean ? boolean : T extends number ? number : T extends string ? string : T;

/** All config for this request: stored values over defaults. */
export const getConfig = cache(async (): Promise<Config> => {
  const rows = await db.systemConfig.findMany();
  const merged = { ...CONFIG_DEFAULTS } as Record<string, unknown>;
  for (const row of rows) {
    if (row.key in CONFIG_DEFAULTS) merged[row.key] = row.value;
  }
  return merged as Config;
});

export async function getConfigValue<K extends ConfigKey>(key: K): Promise<Config[K]> {
  return (await getConfig())[key];
}

/** Write path for config. Callers must already have checked `system.config` (see lib/domain/system.ts). */
export async function writeConfigValue<K extends ConfigKey>(key: K, value: Config[K], updatedById: string) {
  await db.systemConfig.upsert({
    where: { key },
    create: { key, value: value as never, updatedById },
    update: { value: value as never, updatedById },
  });
}

/** True when an integration is switched on AND its credentials are present. */
export async function integrationLive(name: "googleCalendar" | "googleDrive" | "googleChat" | "email" | "push"): Promise<boolean> {
  const cfg = await getConfig();
  if (!cfg[`integrations.${name}`]) return false;
  switch (name) {
    case "googleCalendar":
    case "googleDrive":
    case "googleChat":
    case "email":
      return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    case "push":
      return true; // Expo's push service needs no key for basic sends
  }
}

/** True when a Claude feature is switched on AND an API key is present. */
export async function aiLive(feature: "assistant" | "grading"): Promise<boolean> {
  const cfg = await getConfig();
  const on = feature === "assistant" ? cfg["ai.assistantEnabled"] : cfg["ai.gradingEnabled"];
  return on && Boolean(process.env.ANTHROPIC_API_KEY);
}
