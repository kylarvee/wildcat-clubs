import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Generated file bytes for the mock Drive. Files land in apps/web/storage/seed/…
 * and FileItem.storageKey is the path relative to apps/web/storage, which is
 * where lib/files/storage.ts reads from.
 */

function webRoot(): string {
  // Prefer the script's location (prisma/seed/index.ts → apps/web), fall back to cwd.
  const script = process.argv[1] ? path.resolve(process.argv[1]) : "";
  const fromScript = script ? path.resolve(path.dirname(script), "..", "..") : "";
  if (fromScript && existsSync(path.join(fromScript, "prisma", "schema.prisma"))) return fromScript;
  return process.cwd();
}

export const STORAGE_ROOT = path.join(webRoot(), "storage");
export const SEED_DIR = path.join(STORAGE_ROOT, "seed");

let totalBytes = 0;
export const writtenBytes = () => totalBytes;

export function resetSeedStorage() {
  rmSync(SEED_DIR, { recursive: true, force: true });
  mkdirSync(SEED_DIR, { recursive: true });
  totalBytes = 0;
}

/** Writes bytes under storage/seed and returns the storage key ("seed/<rel>"). */
export function writeSeedFile(rel: string, bytes: Buffer | string): { storageKey: string; sizeBytes: number } {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const full = path.join(SEED_DIR, clean);
  mkdirSync(path.dirname(full), { recursive: true });
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  writeFileSync(full, buf);
  totalBytes += buf.length;
  return { storageKey: `seed/${clean}`, sizeBytes: buf.length };
}

export function safeFileName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+\./g, ".")
    .replace(/^-+|-+$/g, "");
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

/** PDFs here use the standard Helvetica fonts, which only cover Latin-1; keep text ASCII. */
function pdfText(s: string) {
  return s
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[·•]/g, "-")
    .replace(/★/g, "*")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      if (line) lines.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export type PdfBlock = { heading?: string; text?: string; bullets?: string[] };

/**
 * A small, valid, single-page PDF (US Letter) written by hand: a bold title,
 * an optional subtitle, then headed paragraphs and bullets. Text past the
 * bottom margin is dropped so the page stays one page.
 */
export function makePdf(title: string, subtitle: string | null, blocks: PdfBlock[], footer?: string): Buffer {
  type Line = { font: "F1" | "F2"; size: number; text: string; gap: number; indent: number };
  const lines: Line[] = [];
  for (const t of wrap(title, 52)) lines.push({ font: "F2", size: 18, text: t, gap: 22, indent: 0 });
  if (subtitle) for (const t of wrap(subtitle, 90)) lines.push({ font: "F1", size: 10, text: t, gap: 14, indent: 0 });
  lines.push({ font: "F1", size: 10, text: "", gap: 8, indent: 0 });
  for (const b of blocks) {
    if (b.heading) lines.push({ font: "F2", size: 12, text: b.heading, gap: 20, indent: 0 });
    if (b.text) for (const t of wrap(b.text, 92)) lines.push({ font: "F1", size: 10.5, text: t, gap: 14, indent: 0 });
    for (const bullet of b.bullets ?? []) {
      wrap(bullet, 86).forEach((t, i) => lines.push({ font: "F1", size: 10.5, text: (i === 0 ? "- " : "  ") + t, gap: 14, indent: 12 }));
    }
  }

  let y = 740;
  const ops: string[] = [];
  for (const l of lines) {
    y -= l.gap;
    if (y < 80) break;
    if (!l.text) continue;
    ops.push(`BT /${l.font} ${l.size} Tf ${72 + l.indent} ${y} Td (${pdfText(l.text)}) Tj ET`);
  }
  if (footer) ops.push(`BT /F1 8 Tf 72 48 Td (${pdfText(footer)}) Tj ET`);
  const stream = ops.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ─── SVG flyers ──────────────────────────────────────────────────────────────

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function makeFlyerSvg(opts: { club: string; title: string; when: string; where: string; color: string; tagline?: string }): string {
  const titleLines = wrap(opts.title, 18).slice(0, 4);
  const titleSvg = titleLines
    .map((l, i) => `<text x="48" y="${300 + i * 62}" font-family="Helvetica, Arial, sans-serif" font-size="54" font-weight="700" fill="#ffffff">${xml(l)}</text>`)
    .join("\n  ");
  const after = 300 + titleLines.length * 62 + 30;
  const whereLines = wrap(opts.where, 40).slice(0, 2);
  const whereSvg = whereLines
    .map((l, i) => `<text x="48" y="${after + 60 + i * 28}" font-family="Helvetica, Arial, sans-serif" font-size="21" fill="#ffffff" fill-opacity="0.9">${xml(l)}</text>`)
    .join("\n  ");
  const taglineY = after + 60 + whereLines.length * 28 + 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800" role="img" aria-label="${xml(opts.title)} flyer">
  <rect width="600" height="800" fill="${opts.color}"/>
  <circle cx="540" cy="80" r="190" fill="#ffffff" fill-opacity="0.09"/>
  <circle cx="60" cy="760" r="140" fill="#000000" fill-opacity="0.10"/>
  <text x="48" y="110" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="2" fill="#ffffff" fill-opacity="0.85">${xml(opts.club.toUpperCase())}</text>
  <rect x="48" y="132" width="72" height="6" rx="3" fill="#ffffff" fill-opacity="0.8"/>
  ${titleSvg}
  <text x="48" y="${after + 20}" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#ffffff">${xml(opts.when)}</text>
  ${whereSvg}
  ${opts.tagline ? `<text x="48" y="${taglineY}" font-family="Helvetica, Arial, sans-serif" font-size="20" font-style="italic" fill="#ffffff" fill-opacity="0.85">${xml(opts.tagline)}</text>` : ""}
  <text x="48" y="748" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#ffffff" fill-opacity="0.8">Wildcat Clubs · Weber State University · Everyone welcome</text>
</svg>
`;
}
