import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who may download a club's officers of record (lib/domain/officers): the
 * people who open its workspace (leaders from Ambassador up, advisors, and
 * the admins or office staff for the club), never a member or anyone else,
 * and only for an approved club. Each download carries a freshly signed
 * officers link for that club and leaves a private activity row; the verify
 * side accepts only that kind of link.
 */

type Access = { isLeader: boolean; viaPlatform: string | null; role: string | null } | null;
const state = vi.hoisted(() => ({
  club: { id: "robotics", name: "RC Wrecker Bots Club", status: "APPROVED" } as { id: string; name: string; status: string } | null,
  access: null as Access,
  rendered: [] as { url: string }[],
  logged: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({ db: { club: { findUnique: async () => state.club } } }));
vi.mock("@/lib/authz", () => ({ getClubAccess: async () => state.access }));
vi.mock("@/lib/offices", () => ({ officeForClub: async () => ({ name: "WSUSA" }) }));
vi.mock("@/lib/lake/activity", () => ({ logActivity: async (row: Record<string, unknown>) => void state.logged.push(row) }));
vi.mock("@/lib/domain/renewals", () => ({ currentRenewalWindow: async () => ({ window: null, term: null }) }));
vi.mock("@/lib/documents/officers-pdf", () => ({
  renderOfficersPdf: async (_record: unknown, verify: { url: string }) => {
    state.rendered.push(verify);
    return Buffer.from("%PDF-1.3 fake");
  },
}));
vi.mock("@/lib/documents/officers", async (real) => ({
  ...(await real<typeof import("@/lib/documents/officers")>()),
  loadOfficersRecord: async () =>
    state.club
      ? { club: { ...state.club, slug: "rc-wrecker-bots-club", type: "SPONSORED", retiredAt: null }, office: { name: "WSUSA", location: null, hours: null, email: null, phone: null }, recognizedSince: null, renewal: { kind: "none" }, officers: [], advisors: [], generatedAt: new Date("2026-10-20T21:12:00Z") }
      : null,
}));

import { downloadOfficersLetter, mayDownloadOfficers, verifiedOfficers } from "@/lib/domain/officers";
import { issueDocumentToken } from "@/lib/documents/tokens";
import type { Actor } from "@/lib/auth/session";

const priya = { id: "priya", name: "Priya Patel", status: "ACTIVE", platformRole: null } as unknown as Actor;
const leader = (role: string): Access => ({ isLeader: true, viaPlatform: null, role });
const tokenOf = (url: string) => url.split("/verify/")[1];

beforeEach(() => {
  state.club = { id: "robotics", name: "RC Wrecker Bots Club", status: "APPROVED" };
  state.access = leader("PRESIDENT");
  state.rendered = [];
  state.logged = [];
});

const codeOf = async (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? "ERROR");

describe("downloading the officers of record", () => {
  it("is for the club's leaders from Ambassador up, its advisors, and its admins or office staff", async () => {
    for (const access of [leader("PRESIDENT"), leader("OFFICER"), leader("AMBASSADOR"), leader("ADVISOR"), { isLeader: true, viaPlatform: "OFFICE", role: null }, { isLeader: true, viaPlatform: "ADMIN", role: null }]) {
      state.access = access;
      expect(await codeOf(downloadOfficersLetter(priya, "rc-wrecker-bots-club"))).toBe("OK");
    }
    expect(mayDownloadOfficers(leader("AMBASSADOR"))).toBe(true);
    expect(mayDownloadOfficers({ isLeader: false })).toBe(false);
    expect(mayDownloadOfficers(null)).toBe(false);
  });

  it("refuses members and everyone else, naming who can; a founding club isn't found at all", async () => {
    state.access = { isLeader: false, viaPlatform: null, role: "MEMBER" };
    await expect(downloadOfficersLetter(priya, "rc-wrecker-bots-club")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only RC Wrecker Bots Club's leaders, its advisors and WSUSA can download its officers of record.",
    });
    state.access = null;
    expect(await codeOf(downloadOfficersLetter(priya, "rc-wrecker-bots-club"))).toBe("FORBIDDEN");
    state.club = { id: "draft", name: "Wildcat Puzzle Society", status: "SUBMITTED" };
    expect(await codeOf(downloadOfficersLetter(priya, "wildcat-puzzle-society"))).toBe("NOT_FOUND");
    expect(await codeOf(downloadOfficersLetter(null, "rc-wrecker-bots-club"))).toBe("UNAUTHENTICATED");
    expect(state.rendered).toEqual([]);
    expect(state.logged).toEqual([]);
  });

  it("is only for approved clubs, even for their leaders", async () => {
    state.club = { id: "draft", name: "Wildcat Puzzle Society", status: "SUBMITTED" };
    expect(await codeOf(downloadOfficersLetter(priya, "x"))).toBe("CONFLICT");
    state.club = { id: "photo", name: "Photographic Society", status: "RETIRED" };
    await expect(downloadOfficersLetter(priya, "x")).rejects.toThrow(/has retired, so it has no officers of record/);
    state.club = null;
    expect(await codeOf(downloadOfficersLetter(priya, "x"))).toBe("NOT_FOUND");
  });

  it("signs a fresh officers link for the club and logs the download privately", async () => {
    const { pdf, fileName } = await downloadOfficersLetter(priya, "rc-wrecker-bots-club");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(fileName).toBe("officers-of-record-rc-wrecker-bots-club-2026-10-20.pdf");
    expect(tokenOf(state.rendered[0].url)).toMatch(/^or\.robotics\./);
    expect(state.logged).toEqual([expect.objectContaining({ actorId: "priya", action: "officers.downloaded", clubId: "robotics", isPublic: false })]);
    expect((await verifiedOfficers(tokenOf(state.rendered[0].url))).state).toBe("valid");
  });
});

describe("verifying an officers of record link", () => {
  it("shows the live list for an approved club, says so when it retired or is gone, and accepts no other kind of link", async () => {
    const token = issueDocumentToken("officers", "robotics");
    expect(await verifiedOfficers(token)).toMatchObject({ state: "valid", record: { club: { name: "RC Wrecker Bots Club" } } });
    state.club = { id: "robotics", name: "RC Wrecker Bots Club", status: "RETIRED" };
    expect((await verifiedOfficers(token)).state).toBe("retired");
    state.club = null;
    expect((await verifiedOfficers(token)).state).toBe("closed");
    expect((await verifiedOfficers(issueDocumentToken("involvement", "robotics"))).state).toBe("invalid");
    expect((await verifiedOfficers(`${token.slice(0, -2)}xx`)).state).toBe("invalid");
  });
});
