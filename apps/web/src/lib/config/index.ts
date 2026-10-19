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
  /** Reports from different people on one review before an admin task opens. */
  "reviews.flagThreshold": 2,

  /** Check-in opens this many minutes before an occurrence starts and closes this many after it ends. */
  "checkin.opensMinutesBefore": 30,
  "checkin.closesMinutesAfter": 30,
  /** The on-screen QR code changes this often, so a photo of it stops working. */
  "checkin.qrRotateSeconds": 30,

  /**
   * Clubs re-register with WSUSA once a year (lib/renewals). The window opens
   * on the first day of the academic year's first term; renewal is due this
   * many days later, at the end of that day.
   */
  "renewal.dueDays": 30,

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
   * Shown to founders after they submit a club for review, and quoted by the
   * assistant. Student Involvement & Leadership (SIL) runs Clubs & Organizations
   * (https://www.weber.edu/studentinvolvement/). Room, hours, phone and email are
   * its Ogden office's, from https://www.weber.edu/studentinvolvement/contact.html
   * (checked October 2026). Leave a field blank when weber.edu doesn't publish it.
   * reviewDays isn't published there: it's the platform's own estimate.
   * System settings asks a sysadmin to confirm these with WSUSA.
   */
  "wsusa.office": {
    name: "Student Involvement & Leadership",
    location: "Shepherd Union, Room 326",
    hours: "Monday–Friday, 8 a.m.–6 p.m.; Wednesday, 7 a.m.–7 p.m. (extended hours by appointment)",
    email: "wsusa@weber.edu",
    phone: "801-626-6349",
    reviewDays: 10,
  },
  /**
   * Roles, never named people. Clubs & Organizations staff work in SIL
   * (https://www.weber.edu/co/forms.html); the email is SIL's public one, from
   * https://www.weber.edu/studentinvolvement/contact.html. The C&O pages
   * (https://www.weber.edu/co/) publish no general clubs address.
   */
  "wsusa.reviewers": [
    { name: "Clubs & Organizations staff", title: "Student Involvement & Leadership", email: "wsusa@weber.edu" },
  ] as { name: string; title: string; email: string }[],

  /**
   * Where Settings tells people to write when they need someone to step in (a
   * graduation marked by mistake, a retired profile). SIL's public email, from
   * https://www.weber.edu/studentinvolvement/contact.html.
   */
  "platform.supportEmail": "wsusa@weber.edu",

  /**
   * Mobile app store links. While both are blank, no "Get the app" prompt shows
   * (lib/clubs/queries shouldPromptForApp) and /get-the-app says the app is on its way.
   */
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
