import "server-only";
import { Document, View, renderToBuffer } from "@react-pdf/renderer";
import { fmtDate, fmtTime } from "@/lib/time";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { overseenBy } from "@/lib/offices/rules";
import { COLORS, DocHeader, DocPage, SectionHead, TableSection, Txt, VerifyFooter, pdfText, TYPE } from "./kit";
import { renewalFact, sinceLine, type AdvisorRow, type OfficerRow, type OfficersRecord } from "./officers";
import type { DocumentVerification } from "./involvement-pdf";

/**
 * THE OFFICERS OF RECORD as a one-page letter (./officers), built fresh on
 * every download in the involvement record's look (./kit): the club, the
 * office that oversees it and where the club stands, its officers and
 * advisors with their titles and start dates, how to reach the office, and
 * a verification QR code and link that open the live list. A club with a
 * dozen seats or more runs onto a second page; the verification footer is on
 * every page.
 */

const day = (d: Date) => fmtDate(d, "MMMM d, yyyy");
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function OfficersPdf({ record, verify }: { record: OfficersRecord; verify: DocumentVerification }) {
  const club = pdfText(record.club.name);
  const office = pdfText(record.office.name);
  const contact = [record.office.email, record.office.phone].map((v) => pdfText(v)).filter(Boolean).join("  ·  ");
  const renewal = renewalFact(record.renewal);
  const facts: { label: string; value: string; hint?: string }[] = [{ label: "Recognized since", value: record.recognizedSince ? day(record.recognizedSince) : "Not yet approved" }, ...(renewal ? [renewal] : [])];

  return (
    <Document title={`Officers of record: ${club}`} author={PLATFORM.name} subject={`${INSTITUTION.name} club officers of record`} creator={PLATFORM.name} producer={PLATFORM.name} language="en-US">
      <DocPage
        footer={
          <VerifyFooter
            heading="Verify this letter"
            url={verify.url}
            note={`Issued ${day(verify.issuedAt)} at ${fmtTime(verify.issuedAt)}. Scan the code or open the link to see ${club}'s officers as they stand today.`}
          />
        }
      >
        <DocHeader title="Officers of record" subtitle="Clubs and student organizations" meta={`Issued ${day(record.generatedAt)}`} />

        <Txt style={TYPE.title}>{club}</Txt>
        <Txt style={[TYPE.body, { color: COLORS.ink2, marginTop: 4 }]}>{[`A student club at ${INSTITUTION.name}`, overseenBy({ name: office })].join(" · ")}</Txt>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
          {facts.map((f) => (
            <View key={f.label} style={{ flex: 1, backgroundColor: COLORS.brandTint, borderRadius: 4, borderLeftWidth: 3, borderLeftColor: COLORS.brand, paddingVertical: 8, paddingHorizontal: 10 }}>
              <Txt style={TYPE.label}>{f.label.toUpperCase()}</Txt>
              <Txt style={{ fontFamily: "Helvetica-Bold", fontSize: 10, lineHeight: 1.3, color: COLORS.ink, marginTop: 3 }}>{f.value}</Txt>
              {f.hint ? <Txt style={[TYPE.small, { marginTop: 1 }]}>{f.hint}</Txt> : null}
            </View>
          ))}
        </View>

        <Txt style={[TYPE.body, { marginTop: 14 }]}>
          {`${PLATFORM.name} confirms that the people below are the current officers and ${record.advisors.length === 1 ? "advisor" : "advisors"} of ${club}, as listed on the club's org chart on ${day(record.generatedAt)}.`}
        </Txt>

        <TableSection<OfficerRow>
          title="Officers"
          aside={record.officers.length ? count(record.officers.length, "officer", "officers") : undefined}
          rows={record.officers}
          rowKey={(o) => o.id}
          empty="No one holds an officer seat right now."
          columns={[
            { label: "Title", cell: (o) => <Txt style={[TYPE.strong, { fontSize: 8.5, lineHeight: 1.3 }]}>{pdfText(o.title)}</Txt> },
            { label: "Name", flex: 1.2, cell: (o) => pdfText(o.name) },
            { label: "In office since", width: 110, cell: (o) => sinceLine(o.since) },
          ]}
        />

        <TableSection<AdvisorRow>
          title={record.advisors.length === 1 ? "Advisor" : "Advisors"}
          rows={record.advisors}
          rowKey={(a) => a.id}
          empty={`${club} has no faculty or staff advisor right now.`}
          columns={[
            { label: "Role", cell: () => <Txt style={[TYPE.strong, { fontSize: 8.5, lineHeight: 1.3 }]}>Faculty or staff advisor</Txt> },
            { label: "Name", flex: 1.2, cell: (a) => pdfText(a.name) },
            { label: "Advisor since", width: 110, cell: (a) => sinceLine(a.since) },
          ]}
        />

        <View style={{ marginTop: 22, flexDirection: "row", gap: 20 }} wrap={false}>
          <View style={{ flex: 1.15 }}>
            <SectionHead title="Questions about this club" />
            <Txt style={TYPE.body}>{`${office} oversees ${club} and can confirm anything on this letter.`}</Txt>
            {record.office.location ? <Txt style={[TYPE.small, { marginTop: 3 }]}>{pdfText(record.office.location)}</Txt> : null}
            {record.office.hours ? <Txt style={TYPE.small}>{pdfText(record.office.hours)}</Txt> : null}
            {contact ? <Txt style={[TYPE.body, TYPE.strong, { marginTop: 3, color: COLORS.brand }]}>{contact}</Txt> : null}
          </View>
          <View style={{ flex: 1 }}>
            <SectionHead title="About this letter" />
            <Txt style={TYPE.small}>
              {`Generated by ${PLATFORM.name}, ${INSTITUTION.name}'s platform for student clubs, from ${club}'s org chart. It isn't signed by hand: the code below confirms it. Officers' own contact details are never printed, so reach the club through ${office}.`}
            </Txt>
          </View>
        </View>
      </DocPage>
    </Document>
  );
}

export async function renderOfficersPdf(record: OfficersRecord, verify: DocumentVerification): Promise<Buffer> {
  return renderToBuffer(<OfficersPdf record={record} verify={verify} />);
}
