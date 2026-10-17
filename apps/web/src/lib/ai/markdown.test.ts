import { describe, expect, it } from "vitest";
import { inlineText, parseInline, parseMarkdown, safeHref } from "@/lib/ai/markdown";

describe("safeHref", () => {
  it("allows site paths, http(s) and mailto", () => {
    expect(safeHref("/clubs/chess-club")).toBe("/clubs/chess-club");
    expect(safeHref("https://www.weber.edu/wsusa")).toBe("https://www.weber.edu/wsusa");
    expect(safeHref("mailto:wsusa-clubs@weber.edu")).toBe("mailto:wsusa-clubs@weber.edu");
  });
  it("blocks scripts, data and protocol-relative links", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("clubs/chess")).toBeNull();
  });
});

describe("parseInline", () => {
  it("reads bold, italic, code and links", () => {
    const nodes = parseInline("Join **Chess Club** at *6 PM* — see `HERE26` or [the page](/clubs/chess-club).");
    expect(nodes.map((n) => n.t)).toEqual(["text", "strong", "text", "em", "text", "code", "text", "link", "text"]);
    const link = nodes.find((n) => n.t === "link");
    expect(link && link.t === "link" && link.href).toBe("/clubs/chess-club");
  });
  it("keeps unsafe links as plain text", () => {
    const nodes = parseInline("[click](javascript:alert(1))");
    expect(nodes.some((n) => n.t === "link")).toBe(false);
    expect(inlineText(nodes)).toContain("click");
  });
  it("leaves snake_case and unfinished markers alone", () => {
    expect(inlineText(parseInline("use add_personal_task now"))).toBe("use add_personal_task now");
    expect(parseInline("half **written").every((n) => n.t === "text")).toBe(true);
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs, headings and lists", () => {
    const blocks = parseMarkdown("## Next steps\n\nHere's what's left:\n\n- Finish your profile\n- Invite an advisor\n\n1. One\n2. Two");
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "ul", "ol"]);
    const ul = blocks[2];
    expect(ul.t === "ul" && ul.items.length).toBe(2);
  });
  it("reads a table", () => {
    const blocks = parseMarkdown("| Club | Status |\n|---|---|\n| Chess Club | Active |\n| Math Club | Inactive |");
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    expect(table.t).toBe("table");
    if (table.t === "table") {
      expect(table.head.map(inlineText)).toEqual(["Club", "Status"]);
      expect(table.rows).toHaveLength(2);
    }
  });
  it("keeps code blocks verbatim", () => {
    const blocks = parseMarkdown("```\n**not bold**\n```");
    expect(blocks).toEqual([{ t: "code", v: "**not bold**" }]);
  });
  it("never produces raw HTML nodes", () => {
    const blocks = parseMarkdown("<script>alert(1)</script>");
    expect(blocks).toEqual([{ t: "p", c: [{ t: "text", v: "<script>alert(1)</script>" }] }]);
  });
});
