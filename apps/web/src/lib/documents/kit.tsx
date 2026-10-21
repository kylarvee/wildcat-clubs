import "server-only";
import type { ComponentProps, ReactNode } from "react";
import { Circle, Link, Page, Path, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { qrRows } from "./qr";

/**
 * The pieces every platform document is built from (@react-pdf/renderer):
 * page, header, type styles, summary tiles, tables and a footer with a
 * verification QR code. Built-in PDF fonts only (Helvetica), so rendering
 * never needs the network or a font file; text goes through pdfText() so it
 * only uses characters those fonts can draw. Weber State purple accents.
 */

export const COLORS = {
  brand: "#492365",
  brandTint: "#f5f1f9",
  brandLine: "#d9cce6",
  ink: "#17131c",
  ink2: "#423b4b",
  muted: "#6b6475",
  line: "#ddd7e3",
  soft: "#f6f3f9",
  white: "#ffffff",
} as const;

/** Page margins, in points (US Letter is 612 × 792). The bottom leaves room for the footer. */
export const MARGIN = { top: 44, side: 54, bottom: 100 } as const;

/** Keeps only characters the standard PDF fonts (WinAnsi) can draw, with tidy whitespace. */
export function pdfText(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Text without hyphenation: names, titles and numbers read better whole than split ("Engi-neering"). */
const noHyphens = (word: string) => [word];
export function Txt(props: ComponentProps<typeof Text>) {
  return <Text hyphenationCallback={noHyphens} {...props} />;
}

export const TYPE = StyleSheet.create({
  body: { fontFamily: "Helvetica", fontSize: 9.5, color: COLORS.ink, lineHeight: 1.4 },
  kicker: { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: COLORS.brand, letterSpacing: 1.6 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 22, color: COLORS.ink, lineHeight: 1.15 },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 11.5, color: COLORS.ink },
  strong: { fontFamily: "Helvetica-Bold" },
  small: { fontSize: 8.5, color: COLORS.muted, lineHeight: 1.35 },
  tiny: { fontSize: 7.5, color: COLORS.muted, lineHeight: 1.35 },
  label: { fontFamily: "Helvetica-Bold", fontSize: 7, color: COLORS.muted, letterSpacing: 1.1 },
  link: { color: COLORS.brand, textDecoration: "none" },
});

const s = StyleSheet.create({
  // No lineHeight on the page or a View: in this react-pdf version a page's
  // blanks every `render` text (the page numbers), and a unitless lineHeight
  // only scales right on a style that also sets fontSize. So the text styles
  // that wrap set both (TYPE.body, small, tiny, cellText).
  page: { paddingTop: MARGIN.top, paddingBottom: MARGIN.bottom, paddingHorizontal: MARGIN.side, fontFamily: TYPE.body.fontFamily, fontSize: TYPE.body.fontSize, color: TYPE.body.color },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerText: { flex: 1 },
  uni: { fontFamily: "Helvetica-Bold", fontSize: 10.5, color: COLORS.brand, letterSpacing: 1.4 },
  platform: { fontSize: 8.5, color: COLORS.muted, marginTop: 1 },
  headerRight: { alignItems: "flex-end" },
  docTitle: { fontFamily: "Helvetica-Bold", fontSize: 8, color: COLORS.ink, letterSpacing: 1.6 },
  rule: { height: 2, backgroundColor: COLORS.brand, marginTop: 12, marginBottom: 18 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, backgroundColor: COLORS.brandTint, borderRadius: 4, borderLeftWidth: 3, borderLeftColor: COLORS.brand, paddingVertical: 9, paddingHorizontal: 10 },
  tileValue: { fontFamily: "Helvetica-Bold", fontSize: 20, color: COLORS.brand, lineHeight: 1.1 },
  tileLabel: { ...TYPE.label, marginTop: 3 },
  tileHint: { ...TYPE.tiny, marginTop: 2 },
  section: { marginTop: 22 },
  sectionHead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", borderBottomWidth: 0.75, borderBottomColor: COLORS.brandLine, paddingBottom: 4, marginBottom: 8 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionBar: { width: 3, height: 11, backgroundColor: COLORS.brand },
  // Borders sit on the rows, not around the table, so a table that runs onto
  // another page doesn't leave a stray edge behind; the header repeats there.
  thead: { flexDirection: "row", backgroundColor: COLORS.soft, borderWidth: 0.75, borderColor: COLORS.line, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  th: { ...TYPE.label, fontSize: 6.8, paddingVertical: 4.5, paddingHorizontal: 6 },
  tr: { flexDirection: "row", borderLeftWidth: 0.75, borderRightWidth: 0.75, borderBottomWidth: 0.5, borderColor: COLORS.line },
  trLast: { flexDirection: "row", borderLeftWidth: 0.75, borderRightWidth: 0.75, borderBottomWidth: 0.75, borderColor: COLORS.line, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  td: { paddingVertical: 4, paddingHorizontal: 6, fontSize: 8.5 },
  cellText: { fontSize: 8.5, lineHeight: 1.3 },
  tfoot: { flexDirection: "row", backgroundColor: COLORS.brandTint, borderWidth: 0.75, borderColor: COLORS.line, borderTopColor: COLORS.brandLine, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  empty: { ...TYPE.small, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: COLORS.soft, borderRadius: 3 },
  // The footer is separate absolutely placed pieces: in this react-pdf version a
  // fixed View holding a `render` (page-number) Text comes out blank.
  footRule: { position: "absolute", bottom: 78, left: MARGIN.side, right: MARGIN.side, height: 0.5, backgroundColor: COLORS.line },
  footQr: { position: "absolute", bottom: 26, left: MARGIN.side },
  footText: { position: "absolute", bottom: 27, left: MARGIN.side + 58, right: MARGIN.side + 70 },
  footPage: { position: "absolute", bottom: 27, right: MARGIN.side, fontSize: 7.5, color: COLORS.muted },
});

/** The Wildcat Clubs mark (components/shell/Logo), drawn for PDFs. */
export function DocMark({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Rect x="0" y="0" width="32" height="32" rx="9" ry="9" fill={COLORS.brand} />
      <Path d="M7 10.5 L11 22 L16 13.5 L21 22 L25 10.5" fill="none" stroke={COLORS.white} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="16" cy="8.2" r="2.1" fill="#c9b3e6" />
    </Svg>
  );
}

/** A letter page with the platform's margins and type. `footer` (fixed pieces, such as VerifyFooter) sits outside the flow. */
export function DocPage({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <Page size="LETTER" style={s.page} wrap>
      {children}
      {footer}
    </Page>
  );
}

/** Weber State and Wildcat Clubs on the left, the document's name and date on the right, then a purple rule. */
export function DocHeader({ title, subtitle, meta }: { title: string; subtitle: string; meta: string }) {
  return (
    <View>
      <View style={s.header}>
        <DocMark />
        <View style={s.headerText}>
          <Txt style={s.uni}>{INSTITUTION.name.toUpperCase()}</Txt>
          <Txt style={s.platform}>{`${PLATFORM.name} · ${subtitle}`}</Txt>
        </View>
        <View style={s.headerRight}>
          <Txt style={s.docTitle}>{title.toUpperCase()}</Txt>
          <Txt style={[TYPE.tiny, { marginTop: 2 }]}>{meta}</Txt>
        </View>
      </View>
      <View style={s.rule} />
    </View>
  );
}

export type Tile = { value: string; label: string; hint?: string };

/** The summary numbers across the top: big purple figures with short labels. */
export function Tiles({ items }: { items: Tile[] }) {
  return (
    <View style={s.tiles}>
      {items.map((t) => (
        <View key={t.label} style={s.tile}>
          <Txt style={s.tileValue}>{t.value}</Txt>
          <Txt style={s.tileLabel}>{t.label.toUpperCase()}</Txt>
          {t.hint ? <Txt style={s.tileHint}>{t.hint}</Txt> : null}
        </View>
      ))}
    </View>
  );
}

/** A section heading with a purple tick and a rule; `aside` sits at the right ("35 hours in all"). */
export function SectionHead({ title, aside }: { title: string; aside?: string }) {
  return (
    <View style={s.sectionHead}>
      <View style={s.sectionTitleRow}>
        <View style={s.sectionBar} />
        <Txt style={TYPE.h2}>{title}</Txt>
      </View>
      {aside ? <Txt style={TYPE.small}>{aside}</Txt> : null}
    </View>
  );
}

export type Column<T> = {
  label: string;
  /** Fixed width in points; columns without one share what's left, by `flex` (default 1). */
  width?: number;
  flex?: number;
  align?: "left" | "right";
  cell: (row: T) => ReactNode;
};

export type TableSectionProps<T> = {
  title: string;
  aside?: string;
  /** Anything between the heading and the table (a breakdown, a note). */
  intro?: ReactNode;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  /** A shaded last row, one cell per column. */
  total?: ReactNode[];
  /** What to say when there are no rows. */
  empty: string;
};

/**
 * A titled section holding a ruled table. The heading, the intro, the
 * table's header and its first row stay together, so a page never ends on
 * a heading alone; rows never split across pages.
 */
export function TableSection<T>({ title, aside, intro, columns, rows, rowKey, total, empty }: TableSectionProps<T>) {
  const width = (c: Column<T>) => (c.width ? { width: c.width } : { flex: c.flex ?? 1 });
  const align = (c: Column<T>) => ({ textAlign: c.align ?? "left" }) as const;
  const row = (r: T, i: number) => (
    <View key={rowKey(r, i)} style={i === rows.length - 1 && !total ? s.trLast : s.tr} wrap={false}>
      {columns.map((c) => (
        <View key={c.label} style={[s.td, width(c)]}>
          {wrapCell(c.cell(r), align(c))}
        </View>
      ))}
    </View>
  );
  const head = (
    <>
      <SectionHead title={title} aside={aside} />
      {intro}
    </>
  );
  if (rows.length === 0) {
    return (
      <View style={s.section} wrap={false}>
        {head}
        <Txt style={s.empty}>{empty}</Txt>
      </View>
    );
  }
  return (
    <View style={s.section}>
      <View wrap={false}>
        {head}
        <View style={s.thead}>
          {columns.map((c) => (
            <Txt key={c.label} style={[s.th, width(c), align(c)]}>
              {c.label.toUpperCase()}
            </Txt>
          ))}
        </View>
        {row(rows[0], 0)}
      </View>
      {rows.slice(1).map((r, i) => row(r, i + 1))}
      {total ? (
        <View style={s.tfoot} wrap={false}>
          {columns.map((c, i) => (
            <View key={c.label} style={[s.td, width(c)]}>
              {wrapCell(total[i] ?? "", align(c), true)}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function wrapCell(content: ReactNode, align: { textAlign: "left" | "right" }, bold = false) {
  return typeof content === "string" || typeof content === "number" ? <Txt style={[s.cellText, align, bold ? TYPE.strong : {}]}>{String(content)}</Txt> : content;
}

/** Dark runs of each QR row as one path ("M x y h w v 1 h -w z"), so the code is a single crisp vector shape. */
export function qrPath(rows: string[]): string {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (row[x] !== "1") {
        x++;
        continue;
      }
      let w = 1;
      while (row[x + w] === "1") w++;
      d += `M${x} ${y}h${w}v1h-${w}z`;
      x += w;
    }
  });
  return d;
}

/** A QR code for `text`, drawn with the platform's no-library QR matrix (./qr), with a light quiet zone. */
export function QrCode({ text, size }: { text: string; size: number }) {
  const rows = qrRows(text);
  const n = rows.length;
  const quiet = 2;
  return (
    <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`}>
      <Rect x={-quiet} y={-quiet} width={n + quiet * 2} height={n + quiet * 2} fill={COLORS.white} />
      <Path d={qrPath(rows)} fill={COLORS.ink} />
    </Svg>
  );
}

/**
 * The footer on every page: the verification QR code and link, what they
 * do, and the page number. `url` is the document's /verify link; `heading`
 * names what it verifies ("Verify this letter").
 */
export function VerifyFooter({ url, note, heading = "Verify this record" }: { url: string; note: string; heading?: string }) {
  return (
    <>
      <View style={s.footRule} fixed />
      <View style={s.footQr} fixed>
        <QrCode text={url} size={50} />
      </View>
      <View style={s.footText} fixed>
        <Txt style={[TYPE.strong, { fontSize: 8, color: COLORS.ink }]}>{heading}</Txt>
        <Link src={url} style={[TYPE.link, { fontSize: 7.2, marginTop: 1.5 }]}>
          {url}
        </Link>
        <Txt style={[TYPE.tiny, { marginTop: 2 }]}>{note}</Txt>
      </View>
      <Txt style={s.footPage} fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </>
  );
}
