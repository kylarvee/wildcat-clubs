import { describe, expect, test } from "vitest";
import { letterRuns, normalizeQuery, parseQuery, prefixForms, prefixLexeme } from "@/lib/search/query-text";

describe("normalizing what people type", () => {
  test("lowercase, single spaces, trimmed, capped at 100", () => {
    expect(normalizeQuery("  Robotics   CLUB\t")).toBe("robotics club");
    expect(normalizeQuery("x".repeat(150))).toHaveLength(100);
    expect(normalizeQuery("a\u0000b\u0007c")).toBe("a b c");
    expect(normalizeQuery(null)).toBe("");
  });
});

describe("the prefix for the last word", () => {
  test("partial words become prefixes: robo → robotics", () => {
    expect(parseQuery("robo")).toMatchObject({ head: "", tail: "robo", prefix: "robo", prefixes: ["robo"] });
    expect(parseQuery("intro to weld")).toMatchObject({ head: "intro to", tail: "weld", prefix: "weld" });
  });

  test("…plus one and two letters shorter, never under four, for stems", () => {
    expect(prefixForms("roboti")).toEqual(["roboti", "robot", "robo"]);
    expect(prefixForms("nursi")).toEqual(["nursi", "nurs"]);
    expect(prefixForms("chess")).toEqual(["chess", "ches"]);
    expect(prefixForms("art")).toEqual(["art"]);
  });

  test("quotes and tsquery operators never reach a prefix", () => {
    for (const nasty of [`rob'o`, `robo:*`, `robo&|!`, `(robo)`, `<->robo`, `robo\\`, `"robo`, `ro'b''o:A*`]) {
      const p = parseQuery(nasty);
      for (const x of p?.prefixes ?? []) expect(x).toMatch(/^[\p{L}\p{N}]+$/u);
    }
    expect(prefixLexeme("c++")).toBe("c");
    expect(prefixLexeme("o'neil")).toBe("neil");
    expect(prefixLexeme("!!!")).toBeNull();
    expect(parseQuery("!!!")).toBeNull();
  });

  test("accents fold, letters in other scripts stay", () => {
    expect(prefixLexeme("Café")).toBe("cafe");
    expect(prefixLexeme("Día")).toBe("dia");
    expect(prefixLexeme("日本")).toBe("日本");
    expect(letterRuns("Pre-Med")).toEqual(["pre", "med"]);
  });

  test("no prefix after a closed phrase, a minus word or an open quote", () => {
    expect(parseQuery('"intro to welding"')).toMatchObject({ head: '"intro to welding"', tail: null, prefix: null, prefixes: [] });
    expect(parseQuery("chess -online")).toMatchObject({ head: "chess -online", tail: null, prefixes: [] });
    expect(parseQuery('"intro to wel')).toMatchObject({ tail: null, prefixes: [] });
  });

  test("a dangling or leading `or` is ignored", () => {
    expect(parseQuery("chess or")).toMatchObject({ head: "", tail: "chess", prefix: "chess" });
    expect(parseQuery("or")).toBeNull();
    expect(parseQuery("chess or checkers")).toMatchObject({ head: "chess or", tail: "checkers" });
  });

  test("an unbalanced quote can't leak into the rest of the query", () => {
    const p = parseQuery('robot "build')!;
    expect(p.head).toBe('robot "build"');
    expect(p.head.split('"').length % 2).toBe(1);
  });
});

describe("filler words", () => {
  test("dropped when something more specific is left", () => {
    expect(parseQuery("chess club")).toMatchObject({ head: "", tail: "chess", words: ["chess"] });
    expect(parseQuery("clubs for nursing students")).toMatchObject({ words: ["nursing"] });
  });

  test("kept when they're all there is", () => {
    expect(parseQuery("club")).toMatchObject({ tail: "club", prefix: "club", words: [] });
  });

  test("words for name matching skip stop words and minus words", () => {
    expect(parseQuery("the women in engineering -math")!.words).toEqual(["women", "engineering"]);
  });
});
