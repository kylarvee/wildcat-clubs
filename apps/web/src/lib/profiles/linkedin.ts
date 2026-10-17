/**
 * LinkedIn has no open profile API, so people import the Positions.csv from
 * LinkedIn's "Get a copy of your data" export (Settings → Data privacy →
 * Get a copy of your data → Positions). This parses that file. Pure and
 * client-safe: the settings page previews rows in the browser before anything
 * is saved, and the server validates the chosen rows again.
 *
 * Columns: Company Name, Title, Description, Location, Started On, Finished On.
 * Dates look like "Mar 2023"; some exports use "2023" or "03/2023".
 */

export type YearMonth = { year: number; month: number }; // month 1–12

export type ParsedPosition = {
  /** Row number in the file (1 = first data row), for messages. */
  row: number;
  company: string;
  title: string;
  description: string;
  location: string;
  startedOn: YearMonth | null;
  finishedOn: YearMonth | null;
};

export type LinkedInParseResult = {
  positions: ParsedPosition[];
  /** Rows we couldn't use, with the reason (shown under the preview). */
  skipped: { row: number; reason: string }[];
  /** Set when the whole file isn't usable. */
  error?: string;
};

export const LINKEDIN_COLUMNS = ["Company Name", "Title", "Description", "Location", "Started On", "Finished On"] as const;
export const LINKEDIN_MAX_ROWS = 100;

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Mar 2023", "March 2023", "2023", "03/2023", "2023-03" → { year, month }. Year-only means January. */
export function parseLinkedInDate(raw: string): YearMonth | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    return month ? valid(Number(m[2]), month) : null;
  }
  m = /^(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return valid(Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]));
  m = /^(\d{4})$/.exec(s);
  if (m) return valid(Number(m[1]), 1);
  return null;
}

function valid(year: number, month: number): YearMonth | null {
  if (year < 1950 || year > 2100 || month < 1 || month > 12) return null;
  return { year, month };
}

export function ymKey(ym: YearMonth | null): string {
  return ym ? `${ym.year}-${String(ym.month).padStart(2, "0")}` : "";
}

export function compareYm(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/** Same job twice? Title + company + start month, ignoring case and spacing. */
export function positionKey(p: { title: string; company: string; startedOn: YearMonth | null }): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(p.title)}|${norm(p.company)}|${ymKey(p.startedOn)}`;
}

export function parseLinkedInPositions(text: string): LinkedInParseResult {
  const rows = parseCsv(text);
  if (!rows.length) return { positions: [], skipped: [], error: "That file is empty." };
  // The export has the header first, but tolerate a few lines of notes above it.
  const headerAt = rows.slice(0, 10).findIndex((r) => r.some((f) => f.trim() === "Company Name") && r.some((f) => f.trim() === "Title"));
  if (headerAt === -1)
    return {
      positions: [],
      skipped: [],
      error: "This doesn't look like LinkedIn's Positions.csv — we couldn't find the Company Name and Title columns. Make sure you picked Positions.csv from the export.",
    };
  const header = rows[headerAt].map((h) => h.trim());
  const col = (name: (typeof LINKEDIN_COLUMNS)[number]) => header.indexOf(name);
  const idx = { company: col("Company Name"), title: col("Title"), description: col("Description"), location: col("Location"), start: col("Started On"), end: col("Finished On") };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  const positions: ParsedPosition[] = [];
  const skipped: { row: number; reason: string }[] = [];
  rows.slice(headerAt + 1).forEach((r, i) => {
    const row = i + 1;
    const company = get(r, idx.company);
    const title = get(r, idx.title);
    const startRaw = get(r, idx.start);
    const endRaw = get(r, idx.end);
    const startedOn = parseLinkedInDate(startRaw);
    const finishedOn = parseLinkedInDate(endRaw);
    if (!title || !company) return skipped.push({ row, reason: "missing a title or company" });
    if (!startedOn) return skipped.push({ row, reason: startRaw ? `start date “${startRaw}” isn't a month and year` : "no start date" });
    if (endRaw && !finishedOn) return skipped.push({ row, reason: `end date “${endRaw}” isn't a month and year` });
    if (finishedOn && compareYm(finishedOn, startedOn) < 0) return skipped.push({ row, reason: "ends before it starts" });
    positions.push({
      row,
      company: company.slice(0, 200),
      title: title.slice(0, 200),
      description: get(r, idx.description).slice(0, 2000),
      location: get(r, idx.location).slice(0, 200),
      startedOn,
      finishedOn,
    });
  });
  if (positions.length > LINKEDIN_MAX_ROWS) {
    for (const p of positions.slice(LINKEDIN_MAX_ROWS)) skipped.push({ row: p.row, reason: `only the first ${LINKEDIN_MAX_ROWS} positions are imported at once` });
    positions.length = LINKEDIN_MAX_ROWS;
  }
  return { positions, skipped };
}
