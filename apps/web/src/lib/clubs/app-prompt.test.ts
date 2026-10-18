import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * shouldPromptForApp is the one rule behind every "Get the app" prompt: hidden
 * until a sysadmin sets a store link, never for people who have the app, and
 * snoozed for 30 days by "Not now".
 */

const DAY = 86_400_000;
const NOW = new Date("2026-10-18T18:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let user: { hasMobileApp: boolean; appPromptDismissedAt: Date | null; status: string } | null;
let links: { ios: string; android: string };

vi.mock("@/lib/db", () => ({ db: { user: { findUnique: async () => (user ? { ...user } : null) } } }));
vi.mock("@/lib/config", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/config")>();
  return { ...real, getConfig: async () => ({ ...real.CONFIG_DEFAULTS, "app.iosUrl": links.ios, "app.androidUrl": links.android }) };
});

import { shouldPromptForApp } from "@/lib/clubs/queries";

const ask = (opts: { ignoreSnooze?: boolean } = {}) => shouldPromptForApp("u1", { now: NOW, ...opts });

beforeEach(() => {
  user = { hasMobileApp: false, appPromptDismissedAt: null, status: "ACTIVE" };
  links = { ios: "https://apps.apple.com/us/app/wildcat-clubs/id0000000000", android: "" };
});

describe("shouldPromptForApp", () => {
  it("stays hidden while there are no store links, even in Settings", async () => {
    links = { ios: "", android: "" };
    expect(await ask()).toBe(false);
    expect(await ask({ ignoreSnooze: true })).toBe(false);
    links = { ios: "   ", android: "" };
    expect(await ask()).toBe(false);
  });

  it("shows once either store link is set", async () => {
    expect(await ask()).toBe(true);
    links = { ios: "", android: "https://play.google.com/store/apps/details?id=edu.weber.wildcatclubs" };
    expect(await ask()).toBe(true);
  });

  it("stays hidden for 30 days after Not now", async () => {
    user!.appPromptDismissedAt = ago(DAY);
    expect(await ask()).toBe(false);
    user!.appPromptDismissedAt = ago(30 * DAY - 60_000);
    expect(await ask()).toBe(false);
  });

  it("comes back once 30 days have passed", async () => {
    user!.appPromptDismissedAt = ago(30 * DAY);
    expect(await ask()).toBe(true);
    user!.appPromptDismissedAt = ago(200 * DAY);
    expect(await ask()).toBe(true);
  });

  it("ignores the snooze in Settings, which people open on purpose", async () => {
    user!.appPromptDismissedAt = ago(DAY);
    expect(await ask({ ignoreSnooze: true })).toBe(true);
  });

  it("never shows to someone who already has the app", async () => {
    user!.hasMobileApp = true;
    expect(await ask()).toBe(false);
    expect(await ask({ ignoreSnooze: true })).toBe(false);
    user!.appPromptDismissedAt = ago(400 * DAY);
    expect(await ask()).toBe(false);
  });

  it("never shows to alumni, deactivated or unknown accounts", async () => {
    user!.status = "ALUMNI";
    expect(await ask()).toBe(false);
    user!.status = "DEACTIVATED";
    expect(await ask()).toBe(false);
    user = null;
    expect(await ask()).toBe(false);
  });
});
