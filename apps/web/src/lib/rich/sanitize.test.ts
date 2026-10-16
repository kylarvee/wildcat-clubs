import { describe, expect, it } from "vitest";
import { richToText, sanitizeRichHtml } from "@/lib/rich/sanitize";

describe("sanitizeRichHtml — strips anything dangerous", () => {
  it("removes scripts, styles and their contents", () => {
    const out = sanitizeRichHtml(`<p>Hi</p><script>alert(1)</script><style>body{display:none}</style>`);
    expect(out).toBe("<p>Hi</p>");
  });

  it("removes event handler attributes", () => {
    const out = sanitizeRichHtml(`<img src="https://example.com/a.png" onerror="alert(1)"><p onclick="steal()">x</p>`);
    expect(out).not.toMatch(/onerror|onclick|alert|steal/);
    expect(out).toContain(`<img src="https://example.com/a.png" />`);
  });

  it("removes javascript: and data: links", () => {
    const out = sanitizeRichHtml(`<a href="javascript:alert(1)">a</a><a href="JaVaScRiPt:alert(1)">b</a><a href="data:text/html,<script>1</script>">c</a>`);
    expect(out).not.toMatch(/javascript|data:/i);
  });

  it("removes protocol-relative links", () => {
    expect(sanitizeRichHtml(`<a href="//evil.example/x">x</a>`)).not.toContain("evil");
  });

  it("drops iframes from hosts that aren't video/document providers", () => {
    const out = sanitizeRichHtml(`<iframe src="https://evil.example/embed"></iframe><iframe src="/api/files/abc"></iframe>`);
    expect(out).not.toMatch(/evil|api\/files/);
  });

  it("drops form controls except task-list checkboxes", () => {
    const out = sanitizeRichHtml(`<input type="text" value="x"><input type="password"><input type="checkbox" checked onchange="x()">`);
    expect(out).toBe(`<input type="checkbox" checked="checked" disabled="disabled" />`);
  });

  it("drops arbitrary classes that could restyle the page", () => {
    const out = sanitizeRichHtml(`<div class="fixed inset-0 z-50">x</div><div class="tableWrapper"><table><tbody><tr><td>1</td></tr></tbody></table></div>`);
    expect(out).not.toMatch(/fixed|inset-0|z-50/);
    expect(out).toContain(`<div class="tableWrapper">`);
  });

  it("drops dangerous styles and keeps safe ones", () => {
    const out = sanitizeRichHtml(`<p style="position:fixed;top:0;background-image:url(https://x);text-align:center">x</p>`);
    expect(out).toBe(`<p style="text-align:center">x</p>`);
  });

  it("drops embed attributes with unknown kinds or unsafe sources", () => {
    expect(sanitizeRichHtml(`<div data-embed="script" data-src="https://x.example"></div>`)).toBe("<div></div>");
    const out = sanitizeRichHtml(`<div data-embed="video" data-src="javascript:alert(1)" data-id="x y z"></div>`);
    expect(out).toBe(`<div data-embed="video"></div>`);
    expect(sanitizeRichHtml(`<div data-embed="document" data-src="//evil.example/doc"></div>`)).toBe(`<div data-embed="document"></div>`);
  });
});

describe("sanitizeRichHtml — keeps what the editor makes", () => {
  it("keeps embed placeholders", () => {
    const html = `<div data-embed="video" data-src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" data-title="Club intro"></div>`;
    expect(sanitizeRichHtml(html)).toBe(`<div data-embed="video" data-src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" data-title="Club intro"></div>`);
    const file = `<div data-embed="file" data-id="cm1abc123" data-title="Constitution.pdf" data-mime="application/pdf"></div>`;
    expect(sanitizeRichHtml(file)).toBe(file);
    const ev = `<div data-embed="event" data-id="cm9event" data-title="Fall kickoff"></div>`;
    expect(sanitizeRichHtml(ev)).toBe(ev);
    const map = `<div data-embed="map" data-src="Shepherd Union, Weber State University, Ogden, UT" data-title="Shepherd Union"></div>`;
    expect(sanitizeRichHtml(map)).toBe(map);
    const local = `<div data-embed="file" data-id="abc" data-src="/api/files/abc"></div>`;
    expect(sanitizeRichHtml(local)).toBe(local);
  });

  it("keeps tables with colgroups, spans, widths and alignment", () => {
    const html =
      `<table style="min-width:75px"><colgroup><col style="min-width:25px" /><col style="width:120px" /></colgroup>` +
      `<tbody><tr><th colspan="2" style="text-align:center"><p>Head</p></th></tr><tr><td colwidth="120"><p>a</p></td><td rowspan="1"><p>b</p></td></tr></tbody></table>`;
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it("keeps task lists", () => {
    const html =
      `<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked" /><span></span></label><div><p>Book the room</p></div></li>` +
      `<li data-checked="false" data-type="taskItem"><label><input type="checkbox" /><span></span></label><div><p>Order pizza</p></div></li></ul>`;
    const out = sanitizeRichHtml(html);
    expect(out).toContain(`<ul data-type="taskList">`);
    expect(out).toContain(`<li data-checked="true" data-type="taskItem">`);
    expect(out).toContain(`<input type="checkbox" checked="checked" disabled="disabled" />`);
    expect(out).toContain(`<input type="checkbox" disabled="disabled" />`);
    expect(out).toContain(`<div><p>Order pizza</p></div>`);
  });

  it("keeps alignment, highlight, marks, lists and code", () => {
    const html =
      `<h2 style="text-align:right">Title</h2><p style="text-align:justify"><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <mark>hl</mark> <code>x</code></p>` +
      `<ol start="3"><li><p>three</p></li></ol><blockquote><p>q</p></blockquote><pre><code>let a = 1;</code></pre><hr />`;
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it("keeps colored highlights", () => {
    expect(sanitizeRichHtml(`<mark data-color="#fde68a" style="background-color:#fde68a;color:inherit">x</mark>`)).toBe(
      `<mark data-color="#fde68a" style="background-color:#fde68a">x</mark>`,
    );
  });

  it("keeps images, including uploaded ones served from /api/files", () => {
    const html = `<img src="/api/files/cm1abc" alt="Group photo" /><img src="https://example.com/a.png" alt="" title="t" />`;
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it("opens outside links in a new tab and leaves internal links alone", () => {
    expect(sanitizeRichHtml(`<a href="https://weber.edu">WSU</a>`)).toBe(`<a href="https://weber.edu" target="_blank" rel="noopener noreferrer nofollow">WSU</a>`);
    expect(sanitizeRichHtml(`<a href="/clubs/ai-lab">AI Lab</a>`)).toBe(`<a href="/clubs/ai-lab">AI Lab</a>`);
    expect(sanitizeRichHtml(`<a href="mailto:wsusa@weber.edu">mail</a>`)).toBe(`<a href="mailto:wsusa@weber.edu">mail</a>`);
  });

  it("keeps YouTube and Google iframes, sandboxed", () => {
    const out = sanitizeRichHtml(`<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" allowfullscreen="true"></iframe>`);
    expect(out).toContain(`src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"`);
    expect(out).toContain("sandbox=");
    expect(sanitizeRichHtml(`<iframe src="https://docs.google.com/document/d/abcdefghijk/preview"></iframe>`)).toContain("docs.google.com");
  });

  it("is idempotent", () => {
    const html = `<p style="text-align:center"><a href="https://weber.edu">x</a></p><div data-embed="video" data-src="https://youtu.be/dQw4w9WgXcQ"></div><ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked" /><span></span></label><div><p>t</p></div></li></ul>`;
    const once = sanitizeRichHtml(html);
    expect(sanitizeRichHtml(once)).toBe(once);
  });

  it("returns an empty string for nothing", () => {
    expect(sanitizeRichHtml(null)).toBe("");
    expect(sanitizeRichHtml(undefined)).toBe("");
    expect(sanitizeRichHtml("")).toBe("");
  });
});

describe("richToText", () => {
  it("turns blocks into lines and decodes entities", () => {
    expect(richToText(`<h1>Fall &amp; Spring</h1><p>Tom&#39;s &lt;club&gt;</p><ul><li><p>one</p></li><li><p>two</p></li></ul>`)).toBe("Fall & Spring\nTom's <club>\none\ntwo");
  });

  it("names embeds instead of dropping them", () => {
    expect(richToText(`<p>Watch this:</p><div data-embed="video" data-src="https://youtu.be/dQw4w9WgXcQ" data-title="Kickoff recap"></div>`)).toBe(
      "Watch this:\n[Video: Kickoff recap]",
    );
  });

  it("truncates with an ellipsis", () => {
    expect(richToText("<p>abcdefghij</p>", 5)).toBe("abcd…");
  });
});
