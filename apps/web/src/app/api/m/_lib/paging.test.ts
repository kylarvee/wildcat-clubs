import { describe, expect, it } from "vitest";
import { pageOf, parseCursor, parseLimit } from "./paging";

describe("parseCursor", () => {
  it("reads an offset and starts at the top otherwise", () => {
    expect(parseCursor("5")).toBe(5);
    expect(parseCursor("0")).toBe(0);
    expect(parseCursor(null)).toBe(0);
    expect(parseCursor("")).toBe(0);
    expect(parseCursor("-3")).toBe(0);
    expect(parseCursor("abc")).toBe(0);
  });
});

describe("parseLimit", () => {
  it("keeps the page size between 1 and the cap", () => {
    expect(parseLimit("10", 10, 20)).toBe(10);
    expect(parseLimit("500", 10, 20)).toBe(20);
    expect(parseLimit("0", 10, 20)).toBe(10);
    expect(parseLimit(null, 10, 20)).toBe(10);
  });
});

describe("pageOf", () => {
  const rows = Array.from({ length: 12 }, (_, i) => i);

  it("gives the page and the next cursor while more remain", () => {
    expect(pageOf(rows.slice(0, 6), 0, 5)).toEqual({ items: [0, 1, 2, 3, 4], nextCursor: "5" });
    expect(pageOf(rows, 5, 5)).toEqual({ items: [5, 6, 7, 8, 9], nextCursor: "10" });
  });

  it("ends with a null cursor", () => {
    expect(pageOf(rows, 10, 5)).toEqual({ items: [10, 11], nextCursor: null });
    expect(pageOf(rows.slice(0, 5), 0, 5)).toEqual({ items: [0, 1, 2, 3, 4], nextCursor: null });
    expect(pageOf([], 0, 5)).toEqual({ items: [], nextCursor: null });
  });

  it("pages through everything once, with no repeats or gaps", () => {
    const seen: number[] = [];
    let cursor: string | null = "0";
    while (cursor !== null) {
      const offset = parseCursor(cursor);
      const page = pageOf(rows.slice(0, offset + 5 + 1), offset, 5);
      seen.push(...page.items);
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(rows);
  });
});
