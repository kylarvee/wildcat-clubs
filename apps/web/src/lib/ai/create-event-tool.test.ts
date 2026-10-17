import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * create_event with a Google Meet link: the link is made only while the save
 * mirrors to Google (the request isn't kept), so the card and the result must
 * say when the event will have no join link.
 */

const state: { ready: { live: boolean; reason?: string }; sync: string; saved: unknown[] } = { ready: { live: true }, sync: "synced", saved: [] };

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/resolve")>()),
  resolveClub: async () => ({ id: "club1", name: "Chess Club", slug: "chess", status: "APPROVED" }),
}));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  getClubAccess: async () => ({ capabilities: new Set(["events"]), suspended: false }),
}));
vi.mock("@/lib/integrations/google-calendar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/google-calendar")>()),
  googleCalendarReady: async () => state.ready,
}));
vi.mock("@/lib/terms", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/terms")>()), getTerms: async () => [] }));
vi.mock("@/lib/domain/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/domain/events")>()),
  createEvent: async (_actor: unknown, input: unknown) => {
    state.saved.push(input);
    return { id: "e1", google: { status: state.sync } };
  },
}));

import { findTool, validateCall } from "@/lib/ai/tools";
import type { Prepared, WriteTool } from "@/lib/ai/tool-kit";

const actor = { id: "u1", email: "sam@mail.weber.edu", name: "Sam Rivera", handle: "sam", kind: "STUDENT", platformRole: "USER", status: "ACTIVE", avatarColor: "#000", avatarUrl: null } as never;
const online = { club: "Chess", title: "Online night", date: "2026-10-20", start_time: "18:00", location: { type: "online", google_meet: true } };

async function prepare(input: unknown): Promise<Prepared> {
  const checked = validateCall("create_event", input);
  if (!checked.ok) throw new Error(checked.error);
  return (findTool("create_event") as WriteTool).prepare({ actor, now: new Date("2026-10-01T12:00:00Z") }, checked.input as never);
}

beforeEach(() => {
  state.ready = { live: true };
  state.sync = "synced";
  state.saved = [];
});

describe("create_event with a Google Meet link", () => {
  it("promises a Meet link only while Google Calendar sync is live", async () => {
    const p = await prepare(online);
    expect(p.card.details).toContain("Where: Online — a Google Meet link is created when the event is saved.");
    const done = await p.execute();
    expect(state.saved[0]).toMatchObject({ locationType: "VIRTUAL", virtualUrl: null, createMeetLink: true });
    expect(done.data).not.toHaveProperty("join_link");
  });

  it("says there's no join link yet when sync is off", async () => {
    state.ready = { live: false, reason: "Google Calendar sync is off." };
    state.sync = "off";
    const p = await prepare(online);
    expect(p.card.details).toContain("Where: Online, with no join link yet.");
    expect(p.card.details).toContain("A Google Meet link can't be made yet. Google Calendar sync is off. Add a join link in the Events Builder before the event.");
    const done = await p.execute();
    expect(done.data).toHaveProperty("join_link");
  });

  it("tells the assistant there's no join link when the Google save fails", async () => {
    state.sync = "failed";
    const done = await (await prepare(online)).execute();
    expect(done.data).toHaveProperty("join_link");
  });

  it("keeps a pasted join link as is", async () => {
    state.ready = { live: false, reason: "Google Calendar sync is off." };
    const p = await prepare({ ...online, location: { type: "online", link: "https://zoom.us/j/1" } });
    expect(p.card.details).toContain("Where: Online (https://zoom.us/j/1).");
    const done = await p.execute();
    expect(state.saved[0]).toMatchObject({ virtualUrl: "https://zoom.us/j/1", createMeetLink: false });
    expect(done.data).not.toHaveProperty("join_link");
  });
});
