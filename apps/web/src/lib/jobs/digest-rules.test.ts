import { describe, expect, it } from "vitest";
import { digestDue, digestEmail, digestKey, type DigestRow } from "@/lib/jobs/digest-rules";

// Campus time is America/Denver (MDT, UTC−6, in October).
const at = (iso: string) => new Date(iso);
const MORNING = at("2026-10-19T13:05:00Z"); // Mon, Oct 19, 7:05 AM campus

const row = (label: string, count: number, extra: Partial<DigestRow> = {}): DigestRow => ({ label, count, oldest: count ? at("2026-10-14T16:00:00Z") : null, href: `/admin/${label.toLowerCase().replace(/\W+/g, "-")}`, urgent: false, ...extra });

describe("when the digest goes out", () => {
  it("is keyed by the campus day, once a day", () => {
    expect(digestKey(MORNING)).toBe("digest:admins:2026-10-19");
    // 11:30 PM on the 19th in Ogden is already the 20th in UTC.
    expect(digestKey(at("2026-10-20T05:30:00Z"))).toBe("digest:admins:2026-10-19");
  });

  it("waits for 7 AM campus time", () => {
    expect(digestDue(at("2026-10-19T12:59:00Z"))).toBe(false); // 6:59 AM
    expect(digestDue(at("2026-10-19T13:00:00Z"))).toBe(true); // 7:00 AM
    expect(digestDue(at("2026-10-20T05:30:00Z"))).toBe(true); // 11:30 PM
  });
});

describe("the digest email", () => {
  const appUrl = "https://clubs.weber.edu";

  it("says nothing when nothing is waiting and nothing came in", () => {
    expect(digestEmail({ rows: [row("Club submissions", 0)], notices: [], more: 0, since: null, now: MORNING, appUrl })).toBeNull();
  });

  it("lists what's waiting with full links, and the notices held back since the last digest", () => {
    const mail = digestEmail({
      rows: [row("Club submissions", 1), row("Department requests", 0), row("Funding requests", 3), row("New reports", 2, { urgent: true, oldest: null })],
      notices: [
        { title: "New club submitted: Wildcat Puzzle Society", createdAt: at("2026-10-18T20:00:00Z") },
        { title: "Funding request: NSNA — Pinning ceremony", createdAt: at("2026-10-19T01:00:00Z") },
      ],
      more: 4,
      since: at("2026-10-18T13:04:00Z"),
      now: MORNING,
      appUrl,
    })!;
    expect(mail.subject).toBe("Waiting on WSUSA: 6 items · Mon, Oct 19");
    expect(mail.href).toBe("/admin");
    expect(mail.body).toContain("WAITING ON WSUSA (6)");
    expect(mail.body).toContain("• Club submissions: 1, waiting since Oct 14\n  https://clubs.weber.edu/admin/club-submissions");
    expect(mail.body).toContain("• Funding requests: 3, the oldest waiting since Oct 14");
    expect(mail.body).toContain("• New reports: 2 (urgent)");
    expect(mail.body).not.toContain("Department requests");
    expect(mail.body).toContain("NEW SINCE SUN AT 7:04 AM (6)");
    expect(mail.body).toContain("• New club submitted: Wildcat Puzzle Society");
    expect(mail.body).toContain("• …and 4 more notices on your bell.");
    expect(mail.body).toContain("https://clubs.weber.edu/settings/notifications");
  });

  it("still goes out when the queue is empty but something came in", () => {
    const mail = digestEmail({ rows: [row("Funding requests", 0)], notices: [{ title: "Funding request: SWE — Robot Day", createdAt: MORNING }], more: 0, since: null, now: MORNING, appUrl })!;
    expect(mail.subject).toBe("WSUSA digest · Mon, Oct 19");
    expect(mail.body).toContain("NEW IN THE LAST DAY (1)");
    expect(mail.body).not.toContain("WAITING ON WSUSA");
  });
});
