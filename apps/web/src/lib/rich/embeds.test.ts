import { describe, expect, it } from "vitest";
import { embedHtml, fileKind, formatBytes, googleDocInfo, parseDriveFileId, parseYouTube, safeLinkTarget, splitRichHtml, toHttpUrl, videoInfo } from "@/lib/rich/embeds";

describe("video links", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share", "dQw4w9WgXcQ"],
    ["youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("reads %s", (url, id) => {
    expect(parseYouTube(url)?.id).toBe(id);
  });

  it("reads start times", () => {
    expect(parseYouTube("https://youtu.be/dQw4w9WgXcQ?t=90")?.start).toBe(90);
    expect(parseYouTube("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")?.start).toBe(90);
    expect(videoInfo("https://youtu.be/dQw4w9WgXcQ?t=1h")?.embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=3600");
  });

  it("rejects look-alikes", () => {
    expect(parseYouTube("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTube("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseYouTube("javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("reads Google Drive files", () => {
    expect(parseDriveFileId("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing")).toBe("1AbCdEfGhIjKlMnOp");
    expect(parseDriveFileId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp");
    expect(videoInfo("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view")?.embedUrl).toBe("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview");
  });
});

describe("Google documents", () => {
  it("builds preview URLs", () => {
    expect(googleDocInfo("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit?usp=sharing")).toMatchObject({ kind: "doc", previewUrl: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/preview" });
    expect(googleDocInfo("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0")).toMatchObject({ kind: "sheet", previewUrl: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/preview" });
    expect(googleDocInfo("https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOp/edit")?.kind).toBe("slides");
    expect(googleDocInfo("https://docs.google.com/forms/d/e/1FAIpQLSdAbCdEfGh/viewform")).toMatchObject({ kind: "form", previewUrl: "https://docs.google.com/forms/d/e/1FAIpQLSdAbCdEfGh/viewform?embedded=true" });
    expect(googleDocInfo("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp")?.kind).toBe("folder");
    expect(googleDocInfo("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view")?.kind).toBe("file");
    expect(googleDocInfo("https://example.com/document/d/1AbCdEfGhIjKlMnOp")).toBeNull();
  });
});

describe("urls", () => {
  it("adds https to bare domains and refuses other schemes", () => {
    expect(toHttpUrl("weber.edu/clubs")?.toString()).toBe("https://weber.edu/clubs");
    expect(toHttpUrl("javascript:alert(1)")).toBeNull();
    expect(toHttpUrl("not a url")).toBeNull();
  });

  it("allows same-site paths but not protocol-relative ones", () => {
    expect(safeLinkTarget("/api/files/abc")).toBe("/api/files/abc");
    expect(safeLinkTarget("//evil.example")).toBeNull();
    expect(safeLinkTarget("/\\evil.example")).toBeNull();
  });
});

describe("files", () => {
  it("knows kinds by mime or extension", () => {
    expect(fileKind("application/pdf")).toBe("pdf");
    expect(fileKind(null, "Budget.XLSX")).toBe("sheet");
    expect(fileKind("application/octet-stream", "notes.docx")).toBe("doc");
    expect(fileKind("image/png")).toBe("image");
    expect(fileKind(null, "mystery")).toBe("other");
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatBytes(null)).toBe("");
  });
});

describe("splitRichHtml", () => {
  it("splits top-level embeds out of the HTML, in order", () => {
    const html = `<p>Before</p>${embedHtml({ embed: "video", src: "https://youtu.be/dQw4w9WgXcQ", title: "A & B" })}<p>After</p>`;
    const parts = splitRichHtml(html);
    expect(parts).toEqual([
      { type: "html", html: "<p>Before</p>" },
      { type: "embed", attrs: { embed: "video", id: null, src: "https://youtu.be/dQw4w9WgXcQ", title: "A & B", mime: null } },
      { type: "html", html: "<p>After</p>" },
    ]);
  });

  it("handles consecutive embeds and void tags", () => {
    const html = `<p>a<br />b</p><hr />${embedHtml({ embed: "event", id: "e1" })}${embedHtml({ embed: "map", src: "Union" })}<img src="/x" />`;
    const parts = splitRichHtml(html);
    expect(parts.map((p) => p.type)).toEqual(["html", "embed", "embed", "html"]);
  });

  it("turns embeds nested in lists or tables into links", () => {
    const html = `<ul><li>${embedHtml({ embed: "video", src: "https://youtu.be/dQw4w9WgXcQ", title: "Clip" })}</li></ul>`;
    const parts = splitRichHtml(html);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ type: "html", html: `<ul><li><a href="https://youtu.be/dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer">Clip</a></li></ul>` });
  });

  it("drops blank paragraphs left between embeds", () => {
    const html = `${embedHtml({ embed: "event", id: "e1" })}<p></p>${embedHtml({ embed: "map", src: "Union" })}<p><br /></p>`;
    expect(splitRichHtml(html).map((p) => p.type)).toEqual(["embed", "embed"]);
  });

  it("returns plain html untouched", () => {
    expect(splitRichHtml("<p>Hi</p>")).toEqual([{ type: "html", html: "<p>Hi</p>" }]);
    expect(splitRichHtml("")).toEqual([]);
  });

  it("escapes attribute values it writes", () => {
    expect(embedHtml({ embed: "document", src: "https://x.example/?a=1&b=2", title: `"Q" <script>` })).toBe(
      `<div data-embed="document" data-src="https://x.example/?a=1&amp;b=2" data-title="&quot;Q&quot; &lt;script&gt;"></div>`,
    );
  });
});
