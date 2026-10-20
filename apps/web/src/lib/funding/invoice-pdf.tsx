import "server-only";
import { Document, Page, StyleSheet, View, renderToBuffer } from "@react-pdf/renderer";
import type { ClubType, FundingSource, FundingStatus, InvoiceStatus } from "@prisma/client";
import { fmtLongDate, fmtMoney } from "@/lib/time";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { TYPE_LABEL } from "@/components/founding/copy";
import { COLORS, Txt, pdfText as t } from "@/lib/documents/kit";

import { earlierFundedCents, lineCents } from "@/lib/funding/math";

/**
 * Funding invoice PDFs (@react-pdf/renderer), on the platform's document
 * pieces (lib/documents/kit: colors, text that the built-in Helvetica can
 * draw, no hyphenation). WSUSA staff attach this to the transfer in the
 * university finance system, and the club keeps it for its records.
 */

const { brand: BRAND, ink: INK, muted: MUTED, line: LINE, soft: SOFT } = COLORS;

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 72, paddingHorizontal: 54, fontFamily: "Helvetica", fontSize: 9.5, color: INK, lineHeight: 1.4 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  uni: { fontFamily: "Helvetica-Bold", fontSize: 11, color: BRAND, letterSpacing: 1.5 },
  org: { fontSize: 9, color: INK, marginTop: 2 },
  platform: { fontSize: 8.5, color: MUTED, marginTop: 1 },
  titleBox: { alignItems: "flex-end" },
  title: { fontFamily: "Helvetica-Bold", fontSize: 22, color: INK, letterSpacing: 1, lineHeight: 1.15 },
  number: { fontFamily: "Helvetica-Bold", fontSize: 11, color: BRAND, marginTop: 4 },
  metaRight: { fontSize: 8.5, color: MUTED, marginTop: 2 },
  status: { marginTop: 6, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3, fontFamily: "Helvetica-Bold", fontSize: 7.5, letterSpacing: 1 },
  rule: { height: 2, backgroundColor: BRAND, marginTop: 16, marginBottom: 18 },
  grid: { flexDirection: "row", gap: 18, marginBottom: 18 },
  col: { flex: 1 },
  label: { fontFamily: "Helvetica-Bold", fontSize: 7, color: MUTED, letterSpacing: 1.2, marginBottom: 3 },
  strong: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  small: { fontSize: 8.5, color: MUTED },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginBottom: 6 },
  table: { borderWidth: 0.75, borderColor: LINE, borderRadius: 3 },
  thead: { flexDirection: "row", backgroundColor: SOFT, borderBottomWidth: 0.75, borderBottomColor: LINE },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: MUTED, letterSpacing: 0.8, paddingVertical: 5, paddingHorizontal: 6 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE },
  td: { paddingVertical: 5, paddingHorizontal: 6 },
  cItem: { flex: 1 },
  cMath: { width: 128, textAlign: "right" },
  cTimes: { width: 48, textAlign: "right" },
  cTotal: { width: 72, textAlign: "right" },
  cApproved: { width: 72, textAlign: "right" },
  totals: { marginTop: 10, marginLeft: "auto", width: 230 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, marginTop: 3, borderTopWidth: 1.25, borderTopColor: INK },
  grandText: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  box: { marginTop: 18, padding: 10, backgroundColor: SOFT, borderRadius: 3 },
  para: { marginTop: 3 },
  sign: { marginTop: 28, flexDirection: "row", gap: 24 },
  sigBox: { flex: 1, borderTopWidth: 0.75, borderTopColor: INK, paddingTop: 4, fontSize: 7.5, color: MUTED },
  // The footer is separate absolutely placed pieces: in this react-pdf version a
  // fixed View holding a `render` (page-number) Text comes out blank.
  footRule: { position: "absolute", bottom: 44, left: 54, right: 54, height: 0.5, backgroundColor: LINE },
  footLeft: { position: "absolute", bottom: 30, left: 54, fontSize: 7.5, color: MUTED },
  footRight: { position: "absolute", bottom: 30, right: 54, fontSize: 7.5, color: MUTED },
});

const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The source as a heading plus the office behind it, so long names wrap cleanly. */
function sourceLines(source: FundingSource, club: { department: { name: string } | null; college: { name: string } | null }): [string, string] {
  switch (source) {
    case "DEPARTMENT":
      return ["Department", club.department?.name ?? "The club's sponsoring department"];
    case "COLLEGE":
      return ["College", club.college?.name ?? "The club's college"];
    case "WSUSA":
      return ["WSUSA", INSTITUTION.studentGovernmentLong];
    case "UNIVERSITY":
      return ["University", INSTITUTION.name];
  }
}

export type InvoicePdfData = {
  number: string;
  amountCents: number;
  status: InvoiceStatus;
  createdAt: Date;
  processedAt: Date | null;
  createdBy: { name: string } | null;
  request: {
    id: string;
    title: string;
    justification: string | null;
    status: FundingStatus;
    /** The source the club expected. */
    fundingSource: FundingSource;
    /** The source that funded it (WSUSA records it on approval). */
    fundedSource: FundingSource | null;
    amountRequestedCents: number;
    amountApprovedCents: number | null;
    submittedAt: Date | null;
    decidedAt: Date | null;
    decisionNote: string | null;
    submittedBy: { name: string } | null;
    decidedBy: { name: string } | null;
    term: { name: string };
    /** approvedCents: WSUSA's decision on the line (null on approvals recorded before line-by-line decisions: funded in full). */
    items: { id: string; description: string; eventTitle: string | null; quantity: number; unitCostCents: number; occurrences: number; totalCents: number; approvedCents: number | null }[];
    club: { name: string; type: ClubType; contactEmail: string | null; department: { name: string } | null; college: { name: string } | null };
  };
};

function InvoicePdf({ inv }: { inv: InvoicePdfData }) {
  const r = inv.request;
  const club = r.club;
  const partial = r.status === "PARTIALLY_APPROVED";
  const processed = inv.status === "PROCESSED";
  const clubLine = [TYPE_LABEL[club.type], club.department?.name, club.college?.name].filter(Boolean).join(" · ");
  const funded = r.fundedSource ?? r.fundingSource;
  const [sourceHead, sourceDetail] = sourceLines(funded, club);
  const expectedOther = funded !== r.fundingSource ? sourceLines(r.fundingSource, club)[0] : null;
  return (
    <Document
      title={`Invoice ${inv.number}`}
      author={INSTITUTION.studentGovernmentLong}
      subject={t(`${club.name} — ${r.title}`)}
      creator={PLATFORM.name}
      producer={PLATFORM.name}
      language="en-US"
    >
      <Page size="LETTER" style={s.page} wrap>
        <View style={s.top}>
          <View>
            <Txt style={s.uni}>{INSTITUTION.name.toUpperCase()}</Txt>
            <Txt style={s.org}>{`${INSTITUTION.studentGovernmentLong} (${INSTITUTION.studentGovernment})`}</Txt>
            <Txt style={s.platform}>{`${PLATFORM.name} · Club funding · ${INSTITUTION.city}`}</Txt>
          </View>
          <View style={s.titleBox}>
            <Txt style={s.title}>INVOICE</Txt>
            <Txt style={s.number}>{inv.number}</Txt>
            <Txt style={s.metaRight}>{`Issued ${fmtLongDate(inv.createdAt)}`}</Txt>
            <Txt style={[s.status, processed ? { backgroundColor: "#e6f4ea", color: "#1e6b34" } : { backgroundColor: "#e8eefb", color: "#1d4ea8" }]}>
              {processed && inv.processedAt ? `PROCESSED ${fmtLongDate(inv.processedAt).toUpperCase()}` : "OPEN"}
            </Txt>
          </View>
        </View>
        <View style={s.rule} />

        <View style={s.grid}>
          <View style={s.col}>
            <Txt style={s.label}>CLUB</Txt>
            <Txt style={s.strong}>{t(club.name)}</Txt>
            <Txt style={s.small}>{t(clubLine)}</Txt>
            {club.contactEmail ? <Txt style={s.small}>{t(club.contactEmail)}</Txt> : null}
          </View>
          <View style={s.col}>
            <Txt style={s.label}>FUNDED BY</Txt>
            <Txt style={s.strong}>{sourceHead}</Txt>
            <Txt style={s.small}>{t(sourceDetail)}</Txt>
            {expectedOther ? <Txt style={s.small}>{`The club expected: ${expectedOther}`}</Txt> : null}
            <Txt style={s.small}>{`Semester: ${t(r.term.name)}`}</Txt>
          </View>
          <View style={s.col}>
            <Txt style={s.label}>REQUEST</Txt>
            <Txt style={s.strong}>{t(r.title)}</Txt>
            <Txt style={s.small}>{r.submittedAt ? `Submitted ${fmtLongDate(r.submittedAt)}${r.submittedBy ? ` by ${t(r.submittedBy.name)}` : ""}` : "Not submitted"}</Txt>
          </View>
        </View>

        <Txt style={s.sectionTitle}>Requested items</Txt>
        <View style={s.table}>
          <View style={s.thead}>
            <Txt style={[s.th, s.cItem]}>ITEM</Txt>
            <Txt style={[s.th, s.cMath]}>QTY × UNIT COST</Txt>
            <Txt style={[s.th, s.cTimes]}>TIMES</Txt>
            <Txt style={[s.th, s.cTotal]}>{partial ? "ASKED" : "TOTAL"}</Txt>
            {partial ? <Txt style={[s.th, s.cApproved]}>APPROVED</Txt> : null}
          </View>
          {r.items.map((i) => {
            const earlier = earlierFundedCents(i);
            const got = i.approvedCents ?? i.totalCents;
            return (
              <View key={i.id} style={s.tr} wrap={false}>
                <View style={[s.td, s.cItem]}>
                  <Txt>{t(i.description)}</Txt>
                  <Txt style={s.small}>{i.eventTitle ? `Event: ${t(i.eventTitle)}` : "General cost"}</Txt>
                  {earlier ? <Txt style={s.small}>{`The rest of the line: ${fmtMoney(earlier)} was funded earlier`}</Txt> : null}
                </View>
                <Txt style={[s.td, s.cMath]}>{`${qty(i.quantity)} × ${fmtMoney(i.unitCostCents)}${i.occurrences > 1 ? ` = ${fmtMoney(lineCents(i.quantity, i.unitCostCents))}` : ""}`}</Txt>
                <Txt style={[s.td, s.cTimes]}>{i.occurrences > 1 ? `× ${i.occurrences}` : "once"}</Txt>
                <Txt style={[s.td, s.cTotal]}>{fmtMoney(i.totalCents)}</Txt>
                {partial ? <Txt style={[s.td, s.cApproved]}>{got === 0 ? "Not funded" : fmtMoney(got)}</Txt> : null}
              </View>
            );
          })}
          {r.items.length === 0 ? (
            <View style={s.tr}>
              <Txt style={[s.td, s.small]}>No line items were recorded with this request.</Txt>
            </View>
          ) : null}
        </View>

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}>
            <Txt>Requested</Txt>
            <Txt>{fmtMoney(r.amountRequestedCents)}</Txt>
          </View>
          {partial ? (
            <View style={s.totalRow}>
              <Txt style={s.small}>Not approved</Txt>
              <Txt style={s.small}>{`- ${fmtMoney(Math.max(0, r.amountRequestedCents - inv.amountCents))}`}</Txt>
            </View>
          ) : null}
          <View style={s.grand}>
            <Txt style={s.grandText}>{partial ? "Approved (partial)" : "Approved"}</Txt>
            <Txt style={s.grandText}>{fmtMoney(inv.amountCents)}</Txt>
          </View>
        </View>

        <View style={s.box} wrap={false}>
          <Txt style={s.label}>DECISION</Txt>
          <Txt>
            {`${partial ? "Partly approved" : "Approved"}${r.decidedAt ? ` on ${fmtLongDate(r.decidedAt)}` : ""}${r.decidedBy ? ` by ${t(r.decidedBy.name)}` : ""}, ${INSTITUTION.studentGovernment}.`}
          </Txt>
          {r.decisionNote ? <Txt style={s.para}>{t(r.decisionNote)}</Txt> : null}
          <Txt style={[s.para, s.small]}>
            {processed && inv.processedAt
              ? `The approved amount was processed in the university finance system on ${fmtLongDate(inv.processedAt)}.`
              : `Next step: ${INSTITUTION.studentGovernment} moves the approved amount through the university finance system. Clubs keep itemized receipts for every purchase.`}
          </Txt>
        </View>

        {r.justification ? (
          <View style={{ marginTop: 14 }}>
            <Txt style={s.label}>{"WHY THE CLUB ASKED"}</Txt>
            <Txt>{t(r.justification)}</Txt>
          </View>
        ) : null}

        <View style={s.sign} wrap={false}>
          <Txt style={s.sigBox}>{`Prepared by${inv.createdBy ? `: ${t(inv.createdBy.name)}` : ""}`}</Txt>
          <Txt style={s.sigBox}>Finance system reference</Txt>
          <Txt style={s.sigBox}>Date processed</Txt>
        </View>

        <View style={s.footRule} fixed />
        <Txt style={s.footLeft} fixed>{`${PLATFORM.name} · Invoice ${inv.number} · Request ${r.id}`}</Txt>
        <Txt style={s.footRight} fixed>{`${t(club.name)} · ${t(r.term.name)}`}</Txt>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(inv: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf inv={inv} />);
}
