import { beforeEach, describe, expect, it, vi } from "vitest";

// No database or Google: the outbox, the switches and Gmail are fakes.
const outbox = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
const dropToken = vi.fn(async (_args: unknown) => ({ count: 1 }));
const gmailSend = vi.fn(async (_args: { requestBody: { raw: string } }) => ({}));
const spacesCreate = vi.fn(async (_args: { requestId: string }) => ({ data: { name: "spaces/new" } }));
let live = false;
let clubRow: Record<string, unknown> | null = null;
vi.mock("@/lib/db", () => ({
  db: {
    outboxMessage: { create: outbox },
    pushToken: { findMany: async () => [{ token: "ExponentPushToken[abc]" }], deleteMany: dropToken },
    club: { findUnique: async () => clubRow, update: async () => ({}) },
    conversation: { updateMany: async () => ({ count: 1 }) },
  },
}));
vi.mock("@/lib/config", () => ({ integrationLive: async () => live }));
vi.mock("@googleapis/gmail", () => ({ gmail: () => ({ users: { messages: { send: gmailSend } } }) }));
vi.mock("@googleapis/chat", () => ({ chat: () => ({ spaces: { create: spacesCreate } }) }));
vi.mock("@/lib/integrations/google", async (original) => ({ ...(await original<object>()), googleJwt: () => ({}) }));

const { clubGoogleAccount } = await import("@/lib/integrations/google");
const { ensureClubChatSpace } = await import("@/lib/integrations/google-chat");
const { encodeHeader, oneLine, sendEmail } = await import("@/lib/integrations/email");
const { readExpoTicket, sendPush } = await import("@/lib/integrations/push");

beforeEach(() => {
  live = false;
  outbox.mockClear();
  dropToken.mockClear();
  gmailSend.mockClear();
  spacesCreate.mockClear();
  clubRow = null;
});

describe("club Google account (who sync may act as)", () => {
  const ok = { status: "APPROVED" as const, contactEmail: "robotics@weber.edu", googleAccountVerifiedAt: new Date() };

  it("runs only as a verified account of an approved club", () => {
    expect(clubGoogleAccount(ok).email).toBe("robotics@weber.edu");
    expect(clubGoogleAccount({ ...ok, googleAccountVerifiedAt: null }).email).toBeNull();
    expect(clubGoogleAccount({ ...ok, status: "DRAFT" }).email).toBeNull();
    expect(clubGoogleAccount({ ...ok, status: "RETIRED" }).email).toBeNull();
    expect(clubGoogleAccount({ ...ok, contactEmail: null }).email).toBeNull();
    expect(clubGoogleAccount(null).email).toBeNull();
  });

  it("says why not", () => {
    expect(clubGoogleAccount({ ...ok, googleAccountVerifiedAt: null }).reason).toMatch(/verifies/);
    expect(clubGoogleAccount({ ...ok, status: "SUBMITTED" }).reason).toMatch(/approves/);
  });

  it("makes no Chat space as an unverified account", async () => {
    live = true;
    clubRow = { id: "c1", name: "Chess Club", googleChatSpaceId: null, ...ok, googleAccountVerifiedAt: null };
    expect((await ensureClubChatSpace("c1")).status).toBe("skipped");
    expect(spacesCreate).not.toHaveBeenCalled();
  });

  it("lets a new club account make its own Chat space (Chat refuses a request id another user used)", async () => {
    live = true;
    const requestIdAs = async (contactEmail: string) => {
      spacesCreate.mockClear();
      clubRow = { id: "c1", name: "Chess Club", googleChatSpaceId: null, ...ok, contactEmail };
      expect((await ensureClubChatSpace("c1")).status).toBe("synced");
      return spacesCreate.mock.calls[0][0].requestId;
    };
    const first = await requestIdAs("chess@weber.edu");
    expect(await requestIdAs("chess@weber.edu")).toBe(first);
    expect(await requestIdAs("chess.club@weber.edu")).not.toBe(first);
  });
});

describe("email headers", () => {
  it("flattens control characters to one line", () => {
    expect(oneLine("Chess\r\nBcc: victim@weber.edu\r\n\r\nClick here")).toBe("Chess Bcc: victim@weber.edu Click here");
    expect(oneLine("  tab\there\u0000  ")).toBe("tab here");
  });

  it("encodes subjects as short UTF-8 words that decode back", () => {
    const subject = "“Robotics & Engineering Society” was cancelled — see you next week at the Shepherd Union 🎉";
    const encoded = encodeHeader(subject);
    const words = encoded.split("\r\n ");
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    const decoded = words.map((w) => Buffer.from(w.slice("=?UTF-8?B?".length, -2), "base64").toString("utf8")).join("");
    expect(decoded).toBe(subject);
  });

  it("can't be given extra headers through a name in the subject", async () => {
    live = true;
    await sendEmail({ to: "advisor@weber.edu", subject: "Will you advise X\r\nBcc: victims@weber.edu\r\n\r\nFake body?", body: "Real body" });
    const raw = Buffer.from(gmailSend.mock.calls[0][0].requestBody.raw, "base64url").toString("utf8");
    const [head, body] = raw.split("\r\n\r\n");
    expect(head).not.toMatch(/^Bcc:/im);
    expect(head).toMatch(/^MIME-Version: 1\.0$/m);
    expect(body).toBe("Real body");
    expect(outbox.mock.calls[0][0].data).toMatchObject({ status: "SENT", subject: "Will you advise X Bcc: victims@weber.edu Fake body?" });
  });

  it("refuses a recipient that isn't one plain address", async () => {
    live = true;
    await sendEmail({ to: "a@weber.edu\r\nBcc: b@weber.edu", subject: "Hi", body: "Hi" });
    await sendEmail({ to: "a@weber.edu, b@weber.edu", subject: "Hi", body: "Hi" });
    await sendEmail({ to: "a\u0000@weber.edu", subject: "Hi", body: "Hi" });
    expect(gmailSend).not.toHaveBeenCalled();
    expect(outbox.mock.calls.map((c) => c[0].data.status)).toEqual(["FAILED", "FAILED", "FAILED"]);
  });
});

describe("Expo push tickets", () => {
  it("reads errors Expo returns with HTTP 200", () => {
    expect(readExpoTicket(true, JSON.stringify({ data: { status: "ok", id: "t1" } }))).toEqual({ sent: true, error: null, deviceGone: false });
    const gone = readExpoTicket(true, JSON.stringify({ data: { status: "error", message: "Not a registered push notification recipient", details: { error: "DeviceNotRegistered" } } }));
    expect(gone).toEqual({ sent: false, error: "Not a registered push notification recipient", deviceGone: true });
    expect(readExpoTicket(true, JSON.stringify({ data: [{ status: "error", message: "Too big", details: { error: "MessageTooBig" } }] }))).toMatchObject({ sent: false, deviceGone: false });
    expect(readExpoTicket(false, "Bad gateway")).toEqual({ sent: false, error: "Bad gateway", deviceGone: false });
    expect(readExpoTicket(true, "not json")).toMatchObject({ sent: false });
  });

  it("records the failure and forgets a device Expo no longer knows", async () => {
    live = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { status: "error", message: "Gone", details: { error: "DeviceNotRegistered" } } }), { status: 200 }),
    );
    await sendPush("u1", { title: "Hi" });
    expect(outbox.mock.calls[0][0].data).toMatchObject({ status: "FAILED", error: "Gone" });
    expect(dropToken).toHaveBeenCalledWith({ where: { token: "ExponentPushToken[abc]" } });
    fetchMock.mockRestore();
  });
});
