import { describe, expect, it } from "vitest";
import type { MessageView } from "@/lib/domain/messaging";
import { MESSAGE_MAX_LENGTH, campusDayKey, dayLabel, firstName, groupMessages, linkifyParts, listStamp, messageBodyProblem, normalizeMessageBody, previewText } from "@/components/messages/format";
import { mergeMessages, splitAtUnread, type UiMessage } from "@/components/messages/thread";

const person = (id: string, name = id) => ({ id, name, handle: id, avatarUrl: null, avatarColor: "#492365" });
const msg = (id: string, authorId: string, createdAt: string, body = id): MessageView => ({ id, conversationId: "c1", author: person(authorId), body, createdAt, editedAt: null, deleted: false });

describe("message bodies", () => {
  it("normalizes line endings, trailing spaces and long blank runs", () => {
    expect(normalizeMessageBody("  hi \r\nthere\t\r\n\r\n\r\n\r\nbye  ")).toBe("hi\nthere\n\nbye");
  });
  it("explains what's wrong", () => {
    expect(messageBodyProblem("")).toMatch(/Write a message/);
    expect(messageBodyProblem("x".repeat(MESSAGE_MAX_LENGTH))).toBeNull();
    expect(messageBodyProblem("x".repeat(MESSAGE_MAX_LENGTH + 1))).toMatch(/4,000/);
  });
  it("previews on one line", () => {
    expect(previewText("a\n\nb   c", 10)).toBe("a b c");
    expect(previewText("abcdefghijklmnop", 8)).toBe("abcdefg…");
  });
  it("uses first names, keeping titles with the surname", () => {
    expect(firstName("Priya Patel")).toBe("Priya");
    expect(firstName("Dr. Elena Alvarez")).toBe("Dr. Alvarez");
  });
});

describe("linkifyParts", () => {
  it("links http(s) and www. links and leaves sentence punctuation out", () => {
    const parts = linkifyParts("See https://weber.edu/clubs. Or www.example.com!");
    expect(parts.filter((p) => p.type === "link")).toEqual([
      { type: "link", text: "https://weber.edu/clubs", href: "https://weber.edu/clubs" },
      { type: "link", text: "www.example.com", href: "https://www.example.com" },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe("See https://weber.edu/clubs. Or www.example.com!");
  });
  it("keeps a closing parenthesis that belongs to the URL", () => {
    const [link] = linkifyParts("https://en.wikipedia.org/wiki/Ogden_(city)").filter((p) => p.type === "link");
    expect(link.text).toBe("https://en.wikipedia.org/wiki/Ogden_(city)");
  });
  it("never links other schemes", () => {
    expect(linkifyParts("javascript:alert(1) mailto:a@b.c").every((p) => p.type === "text")).toBe(true);
  });
});

describe("grouping", () => {
  it("groups by campus day, then by sender within five minutes", () => {
    const rows = [
      msg("1", "a", "2026-10-16T18:00:00.000Z"),
      msg("2", "a", "2026-10-16T18:04:00.000Z"),
      msg("3", "a", "2026-10-16T18:10:00.000Z"),
      msg("4", "b", "2026-10-16T18:11:00.000Z"),
      // 11:30 PM UTC on the 16th is still the 16th in Ogden; 7 AM UTC on the 17th is the 17th.
      msg("5", "b", "2026-10-17T07:00:00.000Z"),
    ].map((m) => ({ ...m, authorId: m.author.id }));
    const days = groupMessages(rows);
    expect(days.map((d) => d.day)).toEqual(["2026-10-16", "2026-10-17"]);
    expect(days[0].groups.map((g) => g.messages.map((m) => m.id))).toEqual([["1", "2"], ["3"], ["4"]]);
  });
  it("splits a sender group at the first unread message", () => {
    const rows = [msg("1", "a", "2026-10-16T18:00:00.000Z"), msg("2", "a", "2026-10-16T18:01:00.000Z"), msg("3", "a", "2026-10-16T18:02:00.000Z")].map((m) => ({ ...m, authorId: "a" }));
    const days = splitAtUnread(groupMessages(rows), "2");
    expect(days[0].groups.map((g) => g.messages.map((m) => m.id))).toEqual([["1"], ["2", "3"]]);
    expect(splitAtUnread(groupMessages(rows), "1")[0].groups).toHaveLength(1);
  });
  it("labels days and list stamps in campus time", () => {
    const now = new Date("2026-10-16T20:00:00.000Z"); // 2 PM in Ogden
    expect(dayLabel("2026-10-16T15:00:00.000Z", now)).toBe("Today");
    expect(dayLabel("2026-10-15T15:00:00.000Z", now)).toBe("Yesterday");
    expect(dayLabel("2026-10-12T15:00:00.000Z", now)).toBe("Monday, October 12");
    expect(dayLabel("2025-10-12T15:00:00.000Z", now)).toBe("October 12, 2025");
    expect(listStamp("2026-10-16T15:05:00.000Z", now)).toBe("9:05 AM");
    expect(campusDayKey("2026-10-17T05:00:00.000Z")).toBe("2026-10-16");
  });
});

describe("mergeMessages", () => {
  const me = "me";
  it("adds new messages in time order and replaces edited ones by id", () => {
    const prev: UiMessage[] = [msg("1", "a", "2026-10-16T18:00:00.000Z"), msg("2", "b", "2026-10-16T18:01:00.000Z")];
    const edited = { ...msg("1", "a", "2026-10-16T18:00:00.000Z", "fixed"), editedAt: "2026-10-16T18:05:00.000Z" };
    const out = mergeMessages(prev, [msg("3", "a", "2026-10-16T18:02:00.000Z"), edited], me);
    expect(out.map((m) => m.id)).toEqual(["1", "2", "3"]);
    expect(out[0].body).toBe("fixed");
  });
  it("keeps unconfirmed sends last and drops one when the poll brings back the real message", () => {
    const local: UiMessage = { ...msg("local-1", me, "2026-10-16T18:03:00.000Z", "on my way"), pending: "sending" };
    const failed: UiMessage = { ...msg("local-2", me, "2026-10-16T18:03:01.000Z", "on my way"), pending: "failed" };
    const prev: UiMessage[] = [msg("1", "a", "2026-10-16T18:00:00.000Z"), local, failed];
    const out = mergeMessages(prev, [msg("9", me, "2026-10-16T18:02:59.000Z", "on my way")], me);
    expect(out.map((m) => m.id)).toEqual(["1", "9", "local-2"]);
  });
  it("doesn't mistake an older message with the same text for a pending send", () => {
    const prev: UiMessage[] = [msg("1", me, "2026-10-16T18:00:00.000Z", "ok"), { ...msg("local-1", me, "2026-10-16T18:03:00.000Z", "ok"), pending: "sending" }];
    const out = mergeMessages(prev, [msg("1", me, "2026-10-16T18:00:00.000Z", "ok")], me);
    expect(out.map((m) => m.id)).toEqual(["1", "local-1"]);
  });
  it("loads older pages in front", () => {
    const prev: UiMessage[] = [msg("5", "a", "2026-10-16T18:00:00.000Z")];
    expect(mergeMessages(prev, [msg("4", "b", "2026-10-15T18:00:00.000Z")], me).map((m) => m.id)).toEqual(["4", "5"]);
  });
});
