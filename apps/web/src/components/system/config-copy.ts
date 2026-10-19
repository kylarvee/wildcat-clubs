import type { ConfigKey } from "@/lib/config";

/**
 * Plain-language names and explanations for every platform rule (system
 * config). Client-safe: only a type comes from lib/config. The keys and
 * defaults themselves live in lib/config (CONFIG_DEFAULTS).
 */

export type ConfigCopy = {
  label: string;
  help: string;
  /** Plural unit shown after numbers ("days"); singular is derived by dropping a trailing "s". */
  unit?: string;
  min?: number;
  max?: number;
};

export const CONFIG_COPY: Record<ConfigKey, ConfigCopy> = {
  "activity.studentWindowDays": {
    label: "Active student: recent check-in window",
    help: "A student counts as active in a club if they checked in to one of its events within this many days…",
    unit: "days",
    min: 1,
    max: 365,
  },
  "activity.studentRecentEvents": {
    label: "Active student: recent events",
    help: "…or if they attended at least one of the club's last this-many events — whichever keeps them active longer.",
    unit: "events",
    min: 1,
    max: 20,
  },
  "activity.clubMinEvents": {
    label: "Active club: events held per term",
    help: "A club needs at least this many held events (meetings with at least one check-in) in the current or previous term…",
    unit: "events",
    min: 0,
    max: 50,
  },
  "activity.clubMinMembers": {
    label: "Active club: registered members",
    help: "…and at least this many registered members. New clubs are exempt until their pilot period ends (the end of their first full semester).",
    unit: "members",
    min: 0,
    max: 500,
  },
  "reviews.minAttendance": {
    label: "Events attended before reviewing",
    help: "A student unlocks the review form for a club after checking in to this many of its events. The same for every club.",
    unit: "events",
    min: 1,
    max: 50,
  },
  "reviews.bombingCount": {
    label: "Review bombing: low ratings",
    help: "When a club gets this many low ratings within the window below, an admin task opens to check for review bombing.",
    unit: "ratings",
    min: 2,
    max: 100,
  },
  "reviews.bombingMaxRating": {
    label: "Review bombing: what counts as low",
    help: "Ratings at or below this many stars count toward the check.",
    unit: "stars",
    min: 1,
    max: 4,
  },
  "reviews.bombingWindowHours": {
    label: "Review bombing: time window",
    help: "How close together the low ratings must arrive.",
    unit: "hours",
    min: 1,
    max: 720,
  },
  "reviews.flagThreshold": {
    label: "Reports before a review is queued",
    help: "When this many different students report the same review, it goes to the admin moderation queue as a task. Reported reviews always show in Review moderation.",
    unit: "reports",
    min: 1,
    max: 50,
  },
  "checkin.opensMinutesBefore": {
    label: "Check-in opens",
    help: "Minutes before an event starts that people can begin checking in.",
    unit: "minutes",
    min: 0,
    max: 240,
  },
  "checkin.closesMinutesAfter": {
    label: "Check-in closes",
    help: "Minutes after an event ends that check-in stops. Leaders can still add people by hand later.",
    unit: "minutes",
    min: 0,
    max: 240,
  },
  "checkin.qrRotateSeconds": {
    label: "QR code refresh",
    help: "How often the on-screen QR code changes, so a photo of it stops working.",
    unit: "seconds",
    min: 10,
    max: 300,
  },
  "renewal.dueDays": {
    label: "Days to renew",
    help: "Every approved club re-registers with WSUSA once a year. Renewal opens on the first day of the academic year's first term and is due this many days later. A late renewal doesn't pause or retire anything; WSUSA follows up.",
    unit: "days",
    min: 1,
    max: 180,
  },
  "ai.assistantEnabled": {
    label: "Ask Claude assistant",
    help: "Ask Wildcat Clubs, the in-app assistant that helps students, leaders and administrators set things up and answers questions about the platform.",
  },
  "ai.gradingEnabled": {
    label: "Grading assist",
    help: "Claude compares open-text test answers with the builder's model answer and suggests a grade. A person still decides every grade.",
  },
  "integrations.googleCalendar": {
    label: "Google Calendar",
    help: "Copies club and university events to Google Calendar, and creates Google Meet links when planners ask for one.",
  },
  "integrations.googleDrive": {
    label: "Google Drive",
    help: "Mirrors each club's files into a shared Drive space. Files always live on the platform first.",
  },
  "integrations.googleChat": {
    label: "Google Chat",
    help: "Mirrors club group chats and leader chats to Google Chat spaces. Messaging works in the app either way.",
  },
  "integrations.email": {
    label: "Email",
    help: "Sends notification emails through Gmail from the platform's sender address. While off, emails are recorded in the outbox instead.",
  },
  "integrations.push": {
    label: "Mobile push notifications",
    help: "Sends notifications to the Wildcat Clubs app through Expo's push service. While off, pushes are recorded in the outbox instead.",
  },
  "wsusa.office": {
    label: "WSUSA review office",
    help: "Shown to founders after they submit a club for review, and to leaders requesting funding: the office, where to find it, and how many days a review usually takes.",
  },
  "wsusa.reviewers": {
    label: "Reviewers",
    help: "The people founders can contact about a submission.",
  },
  "platform.supportEmail": {
    label: "Help email",
    help: "Settings tells people to write here when they need someone to step in, like undoing a graduation marked by mistake or fixing a retired profile.",
  },
  "app.iosUrl": {
    label: "App Store link",
    help: "Where the “Get the app” prompt sends iPhone users. Leave blank until the app is published.",
  },
  "app.androidUrl": {
    label: "Google Play link",
    help: "Where the “Get the app” prompt sends Android users. Leave blank until the app is published.",
  },
};

/** "1 day", "30 days". */
export function withUnit(n: number, unit?: string) {
  if (!unit) return String(n);
  // Pinned locale: this renders on the server and in the browser, which must agree.
  return `${n.toLocaleString("en-US")} ${n === 1 ? unit.replace(/s$/, "") : unit}`;
}
