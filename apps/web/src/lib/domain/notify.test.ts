import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * notify()'s delivery: bells for everyone at once, email and push per the
 * registry and each person's choices, sent now for a small audience and
 * queued for the "Send queued messages" job above QUEUE_OVER people.
 */

type U = { id: string; email: string; emailNotifications: boolean; notificationPrefs: unknown; platformRole: string; status: string };

const state = vi.hoisted(() => ({ users: [] as U[], bells: [] as { userId: string; kind: string }[] }));

vi.mock("@/lib/db", () => ({
  db: {
    notification: { createMany: async ({ data }: { data: { userId: string; kind: string }[] }) => void state.bells.push(...data) },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => state.users.filter((u) => where.id.in.includes(u.id) && u.status !== "DEACTIVATED"),
    },
  },
}));
const email = vi.hoisted(() => ({ sendEmail: vi.fn(async (_input: { to: string }) => {}), queueEmails: vi.fn(async (rows: unknown[]) => rows.length) }));
const push = vi.hoisted(() => ({ sendPush: vi.fn(async (_userId: string, _input: unknown) => {}), queuePushes: vi.fn(async (_sends: { userIds: string[] }[]) => 0) }));
vi.mock("@/lib/integrations/email", () => email);
vi.mock("@/lib/integrations/push", () => push);
vi.mock("@/lib/authz/people", () => ({ adminIds: async () => [], clubCapabilityHolders: async () => [] }));

import { notify, notifyEach, notifyInBatches, QUEUE_OVER } from "@/lib/domain/notify";

const person = (i: number, extra: Partial<U> = {}): U => ({ id: `u${i}`, email: `p${i}@mail.weber.edu`, emailNotifications: true, notificationPrefs: {}, platformRole: "USER", status: "ACTIVE", ...extra });
const people = (n: number) => Array.from({ length: n }, (_, i) => person(i));
const emailedTo = (calls: unknown[][]) => calls.map((c) => (c[0] as { to: string }).to).sort();

beforeEach(() => {
  state.users = [];
  state.bells = [];
  vi.clearAllMocks();
});

describe("notify", () => {
  it("sends a small audience's email and push now, per the registry and each person's choices", async () => {
    state.users = [person(1), person(2, { notificationPrefs: { membership: { email: false } } }), person(3, { emailNotifications: false }), person(4, { status: "DEACTIVATED" })];
    await notify({ userIds: ["u1", "u2", "u3", "u4", "u1"], kind: "membership.approved", title: "You're in!" });
    expect(state.bells.map((b) => b.userId).sort()).toEqual(["u1", "u2", "u3", "u4"]);
    expect(emailedTo(email.sendEmail.mock.calls)).toEqual(["p1@mail.weber.edu"]);
    expect(push.sendPush.mock.calls.map((c) => c[0]).sort()).toEqual(["u1", "u2", "u3"]);
    expect(email.queueEmails).not.toHaveBeenCalled();
  });

  it("queues email and push for more than QUEUE_OVER people, after writing every bell", async () => {
    state.users = people(QUEUE_OVER + 1);
    await notify({ userIds: state.users.map((u) => u.id), kind: "announcement.new", title: "New announcement from WSUSA" });
    expect(state.bells).toHaveLength(QUEUE_OVER + 1);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(push.sendPush).not.toHaveBeenCalled();
    expect(email.queueEmails.mock.calls[0][0]).toHaveLength(QUEUE_OVER + 1);
    expect(push.queuePushes.mock.calls[0][0][0].userIds).toHaveLength(QUEUE_OVER + 1);
  });

  it("keeps a digest kind's email out of the moment for admins", async () => {
    state.users = [person(1, { platformRole: "ADMIN" }), person(2, { platformRole: "SYSADMIN", notificationPrefs: { adminDigest: { email: false } } })];
    await notify({ userIds: ["u1", "u2"], kind: "funding.submitted", title: "Funding request: SWE — Robot Day" });
    expect(emailedTo(email.sendEmail.mock.calls)).toEqual(["p2@mail.weber.edu"]);
  });

  it("queues a whole big audience in batches, not just the full batches", async () => {
    state.users = people(130);
    await notifyInBatches({ userIds: state.users.map((u) => u.id), kind: "event.cancelled", title: "Build Night is cancelled", email: true }, 100);
    expect(state.bells).toHaveLength(130);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(email.queueEmails.mock.calls.map((c) => (c[0] as unknown[]).length)).toEqual([100, 30]);
  });

  it("queues a sweep's one-per-person notices together once they reach more than QUEUE_OVER people", async () => {
    state.users = people(60);
    await notifyEach({ kind: "requirement.due_soon", notices: state.users.map((u) => ({ userIds: [u.id], title: `Due soon for ${u.id}` })) });
    expect(state.bells).toHaveLength(60);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(email.queueEmails.mock.calls[0][0]).toHaveLength(60);

    vi.clearAllMocks();
    await notifyEach({ kind: "requirement.due_soon", notices: [{ userIds: ["u1"], title: "Due soon" }] });
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.queueEmails).not.toHaveBeenCalled();
  });
});
