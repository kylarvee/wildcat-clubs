import { describe, expect, test } from "vitest";
import { chunkText, cleanText, clip, fileWords, htmlToText, indexable, nameAliases } from "@/lib/search/text";
import { toSegments, withEllipses } from "@/lib/search/headline";
import { allowedTypos, closestWord, editDistance } from "@/lib/search/spelling";

describe("rich text to plain text", () => {
  test("blocks become lines, tags and entities go", () => {
    expect(htmlToText("<p>Build <strong>robots</strong>&nbsp;&amp; more</p><ul><li>Weld</li><li>Code</li></ul>")).toBe("Build robots & more\nWeld\nCode");
    expect(htmlToText("<p>5 &lt; 6 &#8212; &#x2603;</p>")).toBe("5 < 6 — ☃");
  });

  test("an event's pasted-links list and embeds carry no words", () => {
    expect(htmlToText('<p>Bring a laptop.</p><ul data-type="eventLinks"><li><a href="https://x.y">Slides</a></li></ul>')).toBe("Bring a laptop.");
    expect(htmlToText("<p>Hi</p><iframe src=x>junk</iframe>")).toBe("Hi");
  });

  test("control characters never survive (the snippet markers depend on it)", () => {
    expect(cleanText("a\u0001b\u0002c")).toBe("a b c");
    expect(htmlToText("<p>x\u0001y</p>")).toBe("x y");
  });

  test("slashes split words; file names lose their extension", () => {
    expect(indexable("Venture Capital/Private Equity (VC/PE)")).toBe("Venture Capital Private Equity (VC PE)");
    expect(fileWords("Makerspace_Safety Checklist.pdf")).toBe("Makerspace Safety Checklist");
  });
});

describe("passages", () => {
  test("short text is one passage", () => {
    expect(chunkText("We build robots.")).toEqual(["We build robots."]);
  });

  test("long text splits at sentences, each chunk within the limit", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} talks about welding and robots.`).join(" ");
    const chunks = chunkText(text, 200);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  test("one huge sentence is cut at word boundaries", () => {
    const chunks = chunkText("word ".repeat(400), 100);
    expect(chunks.every((c) => c.length <= 100 && !c.startsWith(" "))).toBe(true);
  });

  test("clip adds an ellipsis only when it cuts", () => {
    expect(clip("short", 10)).toBe("short");
    expect(clip("a fairly long sentence here", 12)).toBe("a fairly…");
  });
});

describe("other names a club goes by", () => {
  test("initials for long names without an acronym", () => {
    expect(nameAliases("Society of Physics Students")).toEqual(["SPS"]);
    expect(nameAliases("Model United Nations Organization")).toEqual(["MUNO", "MUN"]);
    expect(nameAliases("National Society of Collegiate Scholars at WSU")).toEqual(["NSCS"]);
  });

  test("nothing when the name already carries one, or is short", () => {
    expect(nameAliases("Society of Women Engineers (SWE)")).toEqual([]);
    expect(nameAliases("Chess Club")).toEqual([]);
    expect(nameAliases("Women in Construction at WSU")).toEqual([]);
  });

  test("each side of a slash", () => {
    expect(nameAliases("Engineering Honor Society / Tau Beta Pi")).toEqual(["EHS", "TBP"]);
  });
});

describe("snippet markers", () => {
  test("hits become marked segments, everything else plain text", () => {
    expect(toSegments("We build \u0001robots\u0002 and \u0001weld\u0002.")).toEqual([
      { text: "We build ", hit: false },
      { text: "robots", hit: true },
      { text: " and ", hit: false },
      { text: "weld", hit: true },
      { text: ".", hit: false },
    ]);
    expect(toSegments("<script>alert(1)</script>")).toEqual([{ text: "<script>alert(1)</script>", hit: false }]);
    expect(toSegments("stray \u0002 end")).toEqual([{ text: "stray  end", hit: false }]);
  });

  test("ellipses where an excerpt is cut", () => {
    const body = "One two three. We build robots every week. Nine ten.";
    const middle = toSegments("We build \u0001robots\u0002 every week.");
    expect(withEllipses(middle, body).map((s) => s.text).join("")).toBe("… We build robots every week. …");
    expect(withEllipses(toSegments(body), body).map((s) => s.text).join("")).toBe(body);
  });
});

describe("close spellings", () => {
  test("edit distance counts a swap as one, and stops early", () => {
    expect(editDistance("robit", "robot")).toBe(1);
    expect(editDistance("form", "from")).toBe(1);
    expect(editDistance("photografi", "photographi")).toBe(2);
    expect(editDistance("chess", "basketball", 2)).toBe(3);
  });

  test("short words aren't corrected; longer ones get more room", () => {
    expect(allowedTypos(3)).toBe(0);
    expect(allowedTypos(5)).toBe(1);
    expect(allowedTypos(8)).toBe(2);
  });

  test("finds the nearest word clubs actually use", () => {
    const vocab = new Map([
      ["robot", 4],
      ["rabbit", 1],
      ["account", 6],
      ["accord", 2],
      ["nurs", 9],
    ]);
    expect(closestWord(["robit", "robitics"], vocab)).toBe("robot");
    expect(closestWord(["acount"], vocab)).toBe("account");
    expect(closestWord(["nursng"], vocab)).toBe("nurs");
    expect(closestWord(["quidditch"], vocab)).toBeNull();
    // Same first letter only: "obot" isn't "robot".
    expect(closestWord(["obot"], vocab)).toBeNull();
  });
});
