import { describe, expect, it } from "vitest";
import {
  categoryAlways,
  categoryChoice,
  categoryDefault,
  DIGEST_KINDS,
  DIGEST_PREF,
  kindsIn,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_KINDS,
  NOTIFICATION_REGISTRY,
  readPrefs,
  resolveDelivery,
  withChoice,
  type KindRule,
  type NotificationPrefs,
  type Recipient,
} from "@/components/notifications/catalog";

/** The registry's one rule (resolveDelivery), as notify() applies it to each recipient. */

const member = (prefs: NotificationPrefs = {}, emailOn = true): Recipient => ({ emailOn, admin: false, prefs });
const admin = (prefs: NotificationPrefs = {}, emailOn = true): Recipient => ({ emailOn, admin: true, prefs });

describe("the registry", () => {
  it("files every kind under one of the nine categories, and every category has kinds", () => {
    const keys = NOTIFICATION_CATEGORIES.map((c) => c.key);
    expect(keys).toHaveLength(9);
    for (const kind of NOTIFICATION_KINDS) expect(keys, kind).toContain(NOTIFICATION_REGISTRY[kind].category);
    for (const key of keys) expect(kindsIn(key).length, key).toBeGreaterThan(0);
  });

  it("names the categories the way Settings shows them", () => {
    expect(NOTIFICATION_CATEGORIES.map((c) => c.label)).toEqual([
      "Events & reminders",
      "Membership",
      "Leadership & elections",
      "WSUSA requirements",
      "Funding",
      "Announcements",
      "Messages",
      "Reviews & reports",
      "Your account",
    ]);
  });

  it("marks account and security notices as always sent", () => {
    const always = NOTIFICATION_KINDS.filter((k) => (NOTIFICATION_REGISTRY[k] as KindRule).always);
    expect(always).toEqual(["profile.alumni", "staffing.gap", "system.admin_granted", "system.admin_revoked", "system.sysadmin_granted", "system.sysadmin_revoked"]);
    expect(categoryAlways("account")).toBe(true);
    expect(categoryAlways("leadership")).toBe(false);
  });

  it("puts WSUSA's routine queue notices in the digest and keeps the urgent ones out", () => {
    expect(DIGEST_KINDS).toEqual(expect.arrayContaining(["club.submitted", "funding.submitted", "constitution.custom_submitted", "review.flagged"]));
    for (const urgent of ["complaint.new", "review.bombing", "staffing.gap"]) expect(DIGEST_KINDS, urgent).not.toContain(urgent);
  });
});

describe("resolveDelivery", () => {
  it("uses each kind's defaults", () => {
    expect(resolveDelivery("membership.approved", member())).toEqual({ email: "now", push: true });
    expect(resolveDelivery("message.new", member())).toEqual({ email: "off", push: true });
    expect(resolveDelivery("file.shared", member())).toEqual({ email: "now", push: false });
    expect(resolveDelivery("task.completed", member())).toEqual({ email: "off", push: false });
  });

  it("lets a call site's situational default replace the kind's", () => {
    // A cancellation within 48 hours also emails.
    expect(resolveDelivery("event.cancelled", member())).toEqual({ email: "off", push: true });
    expect(resolveDelivery("event.cancelled", member(), { email: true })).toEqual({ email: "now", push: true });
    // Inviting every club to co-host stays off email.
    expect(resolveDelivery("event.cohost_request", member(), { email: false }).email).toBe("off");
  });

  it("lets a person's category choice beat the defaults, both ways", () => {
    expect(resolveDelivery("membership.approved", member({ membership: { email: false } })).email).toBe("off");
    expect(resolveDelivery("message.new", member({ messages: { email: true } })).email).toBe("now");
    expect(resolveDelivery("announcement.new", member({ announcements: { push: false } }))).toEqual({ email: "now", push: false });
    // …and the call site's default too.
    expect(resolveDelivery("event.cancelled", member({ events: { email: false } }), { email: true }).email).toBe("off");
    // Another category's choice changes nothing.
    expect(resolveDelivery("membership.approved", member({ funding: { email: false, push: false } }))).toEqual({ email: "now", push: true });
  });

  it("turns every email off with the master switch, and leaves push alone", () => {
    expect(resolveDelivery("membership.approved", member({}, false))).toEqual({ email: "off", push: true });
    expect(resolveDelivery("message.new", member({ messages: { email: true } }, false)).email).toBe("off");
    expect(resolveDelivery("funding.submitted", admin({}, false)).email).toBe("off");
  });

  it("always sends account and security notices, whatever the settings say", () => {
    const nothing = member({ account: { email: false, push: false }, leadership: { email: false, push: false } }, false);
    for (const kind of ["profile.alumni", "system.admin_revoked", "system.sysadmin_granted", "staffing.gap"]) {
      expect(resolveDelivery(kind, nothing, { email: false, push: false }), kind).toEqual({ email: "now", push: true });
    }
  });

  it("holds digest kinds for an admin's daily digest, unless they turned it off", () => {
    expect(resolveDelivery("funding.submitted", admin())).toEqual({ email: "digest", push: true });
    expect(resolveDelivery("club.submitted", admin({ leadership: { email: false } })).email).toBe("digest");
    // Digest off: one email each again, unless the category says no.
    expect(resolveDelivery("funding.submitted", admin({ [DIGEST_PREF]: { email: false } })).email).toBe("now");
    expect(resolveDelivery("review.flagged", admin({ [DIGEST_PREF]: { email: false } })).email).toBe("now");
    expect(resolveDelivery("funding.submitted", admin({ [DIGEST_PREF]: { email: false }, funding: { email: false } })).email).toBe("off");
    // Push isn't held.
    expect(resolveDelivery("funding.submitted", admin({ funding: { push: false } }))).toEqual({ email: "digest", push: false });
    // Not an admin: the kind's own default (the submitter's fellow budget holders hear in-app).
    expect(resolveDelivery("funding.submitted", member())).toEqual({ email: "off", push: true });
  });

  it("still emails admins right away about reports, review bombing and staffing gaps", () => {
    for (const kind of ["complaint.new", "review.bombing", "staffing.gap"]) expect(resolveDelivery(kind, admin()).email, kind).toBe("now");
  });

  it("treats a kind the registry doesn't know like most kinds", () => {
    expect(resolveDelivery("made.up", member())).toEqual({ email: "now", push: true });
    expect(resolveDelivery("made.up", member({}, false), { push: false })).toEqual({ email: "off", push: false });
  });
});

describe("people's choices", () => {
  it("reads only known categories and boolean choices", () => {
    expect(readPrefs({ events: { email: false, push: "no" }, nonsense: { email: false }, funding: "off", messages: { push: true }, [DIGEST_PREF]: { email: false } })).toEqual({
      events: { email: false },
      messages: { push: true },
      [DIGEST_PREF]: { email: false },
    });
    for (const junk of [null, undefined, "x", 3, [], [{ events: { email: false } }]]) expect(readPrefs(junk)).toEqual({});
  });

  it("starts every category on, by email and push", () => {
    for (const { key } of NOTIFICATION_CATEGORIES) {
      for (const channel of ["email", "push"] as const) expect(categoryDefault(key, channel, { admin: false }), `${key} ${channel}`).toBe(true);
    }
  });

  it("stores a switch turned off and clears it when it's back on", () => {
    const off = withChoice({}, "events", "email", false, { admin: false });
    expect(off).toEqual({ events: { email: false } });
    expect(categoryChoice(off, "events", "email", { admin: false })).toBe(false);
    expect(categoryChoice(off, "events", "push", { admin: false })).toBe(true);
    const both = withChoice(off, "events", "push", false, { admin: false });
    expect(both).toEqual({ events: { email: false, push: false } });
    expect(withChoice(withChoice(both, "events", "email", true, { admin: false }), "events", "push", true, { admin: false })).toEqual({});
  });

  it("stores the digest switch only when it's off", () => {
    const off = withChoice({}, DIGEST_PREF, "email", false, { admin: true });
    expect(off).toEqual({ [DIGEST_PREF]: { email: false } });
    expect(withChoice(off, DIGEST_PREF, "email", true, { admin: true })).toEqual({});
  });
});
