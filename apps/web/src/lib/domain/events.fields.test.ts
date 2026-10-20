import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Events Builder's write path (lib/domain/events createEvent) for the
 * newer fields: the cover must be one of the host club's public image files,
 * service minutes can't be more than the event's length (Service projects
 * count by default), perks are stored once each, and an in-person event may
 * keep an online link (hybrid). The database is faked; the write stops at the
 * first insert, which is where the stored row is checked.
 */

class Stop extends Error {}

const state = vi.hoisted(() => ({ files: new Map<string, Record<string, unknown>>(), created: null as Record<string, unknown> | null }));

vi.mock("@/lib/db", () => ({
  db: {
    club: { findUnique: async () => ({ id: "club1", name: "RC Wrecker Bots Club", slug: "rc-wrecker-bots-club", type: "REGISTERED", status: "APPROVED", departmentId: null }) },
    building: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id }) },
    fileItem: { findUnique: async ({ where }: { where: { id: string } }) => state.files.get(where.id) ?? null },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        event: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            state.created = data;
            throw new Stop("stop at the insert");
          },
        },
      }),
  },
}));
vi.mock("@/lib/authz", async (original) => ({
  ...(await original<object>()),
  getClubAccess: async () => ({ clubId: "club1", clubStatus: "APPROVED", role: "PRESIDENT", rank: 5, isMember: true, isPendingMember: false, isLeader: true, isAdvisor: false, viaPlatform: null, capabilities: new Set(["events"]), suspended: false, assignableRoles: [], canRetire: true, canInviteAdvisor: true }),
}));
vi.mock("@/lib/terms", async (original) => ({ ...(await original<object>()), getTerms: async () => [] }));

import { createEvent } from "@/lib/domain/events";

const priya = { id: "u1", email: "priya.patel@mail.weber.edu", name: "Priya Patel", handle: "priyapatel", kind: "STUDENT", platformRole: "USER", status: "ACTIVE", avatarColor: "#492365", avatarUrl: null } as const;
const buildNight = { clubId: "club1", title: "Build Night", kind: "MEETING", startsAt: "2026-11-04T01:00:00.000Z", durationMinutes: 120, locationType: "CAMPUS", buildingId: "nb", room: "150" } as const;

const file = (id: string, over: Record<string, unknown> = {}) =>
  state.files.set(id, { id, clubId: "club1", ownerId: null, parentId: null, isFolder: false, name: "Build night.png", mimeType: "image/png", trashedAt: null, visibility: "PUBLIC", createdById: "u1", ...over });

/** The row createEvent would insert. */
async function stored(input: Record<string, unknown>) {
  await expect(createEvent(priya, { ...buildNight, ...input })).rejects.toBeInstanceOf(Stop);
  return state.created!;
}

beforeEach(() => {
  state.files.clear();
  state.created = null;
});

describe("cover image", () => {
  it("takes one of the club's own public images, stored as its link", async () => {
    file("cover0001");
    expect((await stored({ coverUrl: "/api/files/cover0001" })).coverUrl).toBe("/api/files/cover0001");
    expect((await stored({})).coverUrl).toBeNull();
  });

  it("refuses another club's image, a members-only image, a document and a bad link", async () => {
    file("other0001", { clubId: "club2" });
    file("membr0001", { visibility: "MEMBERS" });
    file("pdf000001", { mimeType: "application/pdf", name: "Minutes.pdf" });
    await expect(createEvent(priya, { ...buildNight, coverUrl: "/api/files/other0001" })).rejects.toThrow(/RC Wrecker Bots Club's own images/);
    await expect(createEvent(priya, { ...buildNight, coverUrl: "/api/files/membr0001" })).rejects.toThrow(/isn't public/);
    await expect(createEvent(priya, { ...buildNight, coverUrl: "/api/files/pdf000001" })).rejects.toThrow(/isn't an image/);
    await expect(createEvent(priya, { ...buildNight, coverUrl: "https://example.com/cat.png" })).rejects.toThrow(/link isn't valid/);
    expect(state.created).toBeNull();
  });
});

describe("service hours", () => {
  it("can't be more than the event's length", async () => {
    await expect(createEvent(priya, { ...buildNight, serviceMinutes: 135 })).rejects.toThrow("Service hours can't be more than the event's length (2 hours).");
    await expect(createEvent(priya, { ...buildNight, serviceMinutes: 50 })).rejects.toThrow(/quarter hours/);
    expect((await stored({ serviceMinutes: 120 })).serviceMinutes).toBe(120);
  });

  it("count by default for a Service project, and not for other events unless turned on", async () => {
    expect((await stored({ kind: "SERVICE" })).serviceMinutes).toBe(120);
    expect((await stored({ kind: "SERVICE", serviceMinutes: null })).serviceMinutes).toBeNull();
    expect((await stored({})).serviceMinutes).toBeNull();
    expect((await stored({ kind: "SOCIAL", serviceMinutes: 60 })).serviceMinutes).toBe(60);
  });
});

describe("perks and hybrid", () => {
  it("stores each perk once, in badge order", async () => {
    expect((await stored({ perks: ["FREE_STUFF", "FREE_FOOD", "FREE_STUFF"] })).perks).toEqual(["FREE_FOOD", "FREE_STUFF"]);
    expect((await stored({})).perks).toEqual([]);
  });

  it("keeps an online link on an in-person event (hybrid), and drops it while the place isn't decided", async () => {
    const campus = await stored({ virtualUrl: "https://meet.google.com/abc-defg-hij" });
    expect(campus).toMatchObject({ locationType: "CAMPUS", buildingId: "nb", virtualUrl: "https://meet.google.com/abc-defg-hij" });
    const offCampus = await stored({ locationType: "ADDRESS", buildingId: null, address: "2464 Jefferson Ave, Ogden", virtualUrl: "https://zoom.us/j/1" });
    expect(offCampus).toMatchObject({ locationType: "ADDRESS", virtualUrl: "https://zoom.us/j/1" });
    expect((await stored({ locationType: "TBD", buildingId: null, virtualUrl: "https://zoom.us/j/1" })).virtualUrl).toBeNull();
    await expect(createEvent(priya, { ...buildNight, virtualUrl: "meet.google.com/abc" })).rejects.toThrow(/https:\/\//);
  });
});
