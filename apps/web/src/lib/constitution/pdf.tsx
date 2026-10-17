import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { fmtLongDate } from "@/lib/time";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { plain, type RenderedDoc } from "@/lib/constitution/render";

/**
 * Constitution / bylaws PDFs (@react-pdf/renderer). Uses the built-in PDF
 * fonts (Times + Helvetica) so rendering never needs the network; text is
 * reduced to the characters those fonts can draw.
 */

const BRAND = "#492365";
const INK = "#17131c";
const MUTED = "#77707f";

const s = StyleSheet.create({
  page: { paddingTop: 64, paddingBottom: 72, paddingHorizontal: 72, fontFamily: "Times-Roman", fontSize: 11, color: INK, lineHeight: 1.45 },
  header: { position: "absolute", top: 28, left: 72, right: 72, flexDirection: "row", justifyContent: "space-between", fontFamily: "Helvetica", fontSize: 7.5, color: MUTED, letterSpacing: 1 },
  // Separate absolutely placed pieces: in this react-pdf version a fixed View
  // holding a page-number `render` Text comes out blank (same fix as invoices).
  footRule: { position: "absolute", bottom: 46, left: 72, right: 72, height: 0.5, backgroundColor: "#d6d0dd" },
  footLeft: { position: "absolute", bottom: 32, left: 72, fontFamily: "Helvetica", fontSize: 8, color: MUTED },
  footRight: { position: "absolute", bottom: 32, right: 72, fontFamily: "Helvetica", fontSize: 8, color: MUTED },
  kicker: { fontFamily: "Helvetica-Bold", fontSize: 9, color: BRAND, letterSpacing: 2, marginBottom: 6 },
  club: { fontFamily: "Times-Bold", fontSize: 24, lineHeight: 1.2, marginBottom: 10 },
  rule: { height: 2, backgroundColor: BRAND, width: 56, marginBottom: 10 },
  meta: { fontFamily: "Helvetica", fontSize: 9, color: MUTED, marginBottom: 22 },
  draft: { fontFamily: "Helvetica-Bold", fontSize: 9, color: "#b45309", marginBottom: 22 },
  preamble: { fontFamily: "Times-Italic", fontSize: 11.5, marginBottom: 18 },
  article: { marginTop: 12 },
  articleNo: { fontFamily: "Helvetica-Bold", fontSize: 8, color: BRAND, letterSpacing: 1.5, marginBottom: 2 },
  articleTitle: { fontFamily: "Times-Bold", fontSize: 13.5, marginBottom: 6 },
  para: { flexDirection: "row", marginBottom: 6 },
  sectionNo: { fontFamily: "Times-Bold", width: 22 },
  paraText: { flex: 1, textAlign: "justify" },
  listItem: { flexDirection: "row", marginBottom: 3, paddingLeft: 22 },
  bullet: { width: 12 },
  signatures: { marginTop: 28, flexDirection: "row", gap: 24 },
  sigBox: { flex: 1, borderTopWidth: 0.75, borderTopColor: INK, paddingTop: 4, fontFamily: "Helvetica", fontSize: 8, color: MUTED },
});

/** Keeps only characters the standard PDF fonts (WinAnsi) can draw. */
function pdfText(text: string) {
  return plain(text)
    .normalize("NFC")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, "");
}

export type PdfMeta = {
  /** Set for adopted documents; omitted for draft previews. */
  adoptedOn?: Date | null;
  version?: number | null;
};

function ConstitutionPdf({ doc, meta }: { doc: RenderedDoc; meta: PdfMeta }) {
  const club = pdfText(doc.clubName);
  return (
    <Document title={pdfText(doc.title)} author={club} subject={`${doc.label} — ${INSTITUTION.name}`} creator={PLATFORM.name} producer={PLATFORM.name} language="en-US">
      <Page size="LETTER" style={s.page} wrap>
        <View style={s.header} fixed>
          <Text>{`${INSTITUTION.name.toUpperCase()}  ·  ${PLATFORM.name.toUpperCase()}`}</Text>
          <Text>{doc.label.toUpperCase()}</Text>
        </View>

        <Text style={s.kicker}>{doc.label.toUpperCase()}</Text>
        <Text style={s.club}>{club}</Text>
        <View style={s.rule} />
        {meta.adoptedOn ? (
          <Text style={s.meta}>{`Adopted ${fmtLongDate(meta.adoptedOn)}${meta.version ? `  ·  Version ${meta.version}` : ""}  ·  Recognized through ${INSTITUTION.studentGovernment}`}</Text>
        ) : (
          <Text style={s.draft}>DRAFT PREVIEW — not adopted. Adopt it in the Wildcat Clubs Constitution Builder to make it official.</Text>
        )}

        <Text style={s.preamble}>{pdfText(doc.preamble)}</Text>

        {doc.articles.map((a) => (
          <View key={a.id} style={s.article}>
            <View minPresenceAhead={60} wrap={false}>
              <Text style={s.articleNo}>{`ARTICLE ${a.roman}`}</Text>
              <Text style={s.articleTitle}>{pdfText(a.title)}</Text>
            </View>
            {numbered(a.blocks).map((b, i) =>
              b.type === "p" ? (
                <View key={i} style={s.para} wrap>
                  <Text style={s.sectionNo}>{`${b.n}.`}</Text>
                  <Text style={s.paraText} orphans={2} widows={2}>
                    {pdfText(b.text)}
                  </Text>
                </View>
              ) : (
                <View key={i}>
                  {b.items.map((item, j) => (
                    <View key={j} style={s.listItem} wrap={false}>
                      <Text style={s.bullet}>•</Text>
                      <Text style={{ flex: 1 }}>{pdfText(item)}</Text>
                    </View>
                  ))}
                </View>
              ),
            )}
          </View>
        ))}

        {meta.adoptedOn ? (
          <View style={s.signatures} wrap={false}>
            <Text style={s.sigBox}>President</Text>
            <Text style={s.sigBox}>Advisor</Text>
            <Text style={s.sigBox}>Date</Text>
          </View>
        ) : null}

        <View style={s.footRule} fixed />
        <Text style={s.footLeft} fixed>{`${club} — ${doc.label}`}</Text>
        <Text style={s.footRight} fixed>
          {meta.adoptedOn ? `Adopted ${fmtLongDate(meta.adoptedOn)}${meta.version ? ` · v${meta.version}` : ""}` : "Draft preview"}
        </Text>
      </Page>
    </Document>
  );
}

/** Paragraphs get section numbers (1., 2., …); lists stay attached to the paragraph before them. */
function numbered(blocks: RenderedDoc["articles"][number]["blocks"]) {
  let n = 0;
  return blocks.map((b) => (b.type === "p" ? { ...b, n: ++n } : b));
}

export async function renderConstitutionPdf(doc: RenderedDoc, meta: PdfMeta = {}): Promise<Buffer> {
  return renderToBuffer(<ConstitutionPdf doc={doc} meta={meta} />);
}
