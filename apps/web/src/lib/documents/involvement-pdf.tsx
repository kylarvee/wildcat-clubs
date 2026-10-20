import "server-only";
import { Document, View, renderToBuffer } from "@react-pdf/renderer";
import { fmtDate, fmtLongDate, fmtTime } from "@/lib/time";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { fmtServiceHours, serviceEventsLabel, serviceHoursLabel } from "@/lib/metrics/service";
import type { ServiceEntry } from "@/lib/metrics/types";
import { COMPLETION_LABEL, clubEventsLabel, seatDates, studyLine, type InvolvementRecord, type RecordCompletion, type RecordSeat, type RecordTermClub } from "./record";
import { COLORS, DocHeader, DocPage, TableSection, Tiles, Txt, VerifyFooter, pdfText, TYPE } from "./kit";

/**
 * THE INVOLVEMENT RECORD as a PDF: built fresh on every download from
 * ./record, so it's always current. Header (the person, Weber State and
 * Wildcat Clubs, the date), four summary tiles, then Leadership, Service
 * hours, Clubs and attendance (by term) and WSUSA trainings and
 * requirements, with a verification QR code and link on every page.
 */

export type DocumentVerification = { url: string; issuedAt: Date };

const day = (d: Date) => fmtDate(d, "MMM d, yyyy");
const hoursWord = (minutes: number) => (minutes === 60 ? "hour" : "hours");

function hostLine(e: Pick<ServiceEntry, "club" | "cohosts">): string {
  if (!e.club) return "University event";
  return pdfText([e.club.name, ...e.cohosts.map((c) => c.name)].join(" + "));
}

type TermRow = RecordTermClub & { term: string | null; termEvents: number; first: boolean };

function InvolvementPdf({ record, verify }: { record: InvolvementRecord; verify: DocumentVerification }) {
  const { person, summary, service, attendance } = record;
  const name = pdfText(person.name);
  const byClubSum = service.byClub.reduce((n, c) => n + c.minutes, 0);
  const termRows: TermRow[] = attendance.byTerm.flatMap((t) => t.clubs.map((c, i) => ({ ...c, term: t.term, termEvents: t.events, first: i === 0 })));
  const required = record.completed.filter((c) => c.required).length;
  const current = record.leadership.filter((s) => !s.endedAt).length;

  return (
    <Document
      title={`Involvement record: ${name}`}
      author={PLATFORM.name}
      subject={`${INSTITUTION.name} student involvement record`}
      creator={PLATFORM.name}
      producer={PLATFORM.name}
      language="en-US"
    >
      <DocPage
        footer={<VerifyFooter url={verify.url} note={`Issued ${fmtLongDate(verify.issuedAt)} at ${fmtTime(verify.issuedAt)}. Scan the code or open the link to see this record as it stands today.`} />}
      >
        <DocHeader title="Involvement record" subtitle="Clubs and student organizations" meta={`Generated ${fmtLongDate(record.generatedAt)}`} />

        <Txt style={TYPE.title}>{name}</Txt>
        <Txt style={[TYPE.body, { color: COLORS.ink2, marginTop: 4 }]}>{pdfText(studyLine(person)) || INSTITUTION.name}</Txt>
        <Txt style={[TYPE.small, { marginTop: 1 }]}>{pdfText(person.email)}</Txt>

        <View style={{ marginTop: 16 }}>
          <Tiles
            items={[
              { value: fmtServiceHours(summary.serviceMinutes), label: "Service hours" },
              { value: summary.serviceEvents.toLocaleString("en-US"), label: "Service events" },
              { value: summary.clubs.toLocaleString("en-US"), label: "Clubs" },
              { value: summary.leadershipRoles.toLocaleString("en-US"), label: "Leadership roles" },
            ]}
          />
        </View>

        <TableSection<RecordSeat>
          title="Leadership"
          aside={current ? `${current} current` : undefined}
          rows={record.leadership}
          rowKey={(s) => s.id}
          empty="No leadership roles yet. Seats on a club's org chart are listed here."
          columns={[
            {
              label: "Role",
              cell: (s) => (
                <View>
                  <Txt style={TYPE.strong}>{pdfText(s.title)}</Txt>
                  {s.via ? <Txt style={TYPE.tiny}>{`Placed by ${pdfText(s.via)}`}</Txt> : null}
                </View>
              ),
            },
            { label: "Club", flex: 1.2, cell: (s) => pdfText(s.club.name) },
            {
              label: "Dates",
              width: 130,
              cell: (s) => (
                <View>
                  <Txt>{seatDates(s)}</Txt>
                  {s.endReason ? <Txt style={TYPE.tiny}>{s.endReason}</Txt> : null}
                </View>
              ),
            },
          ]}
        />

        <TableSection<ServiceEntry>
          title="Service hours"
          aside={service.events ? `${serviceHoursLabel(service.minutes)} · ${serviceEventsLabel(service.events)}` : undefined}
          intro={
            service.events ? (
              <View style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", gap: 18 }}>
                  <Breakdown title="By term" rows={service.byTerm.map((t) => ({ key: t.term ?? "-", label: t.term ?? "Before the academic calendar", minutes: t.minutes }))} />
                  <Breakdown title="By club" rows={service.byClub.map((c) => ({ key: c.club?.id ?? "-", label: c.club ? pdfText(c.club.name) : "University events", minutes: c.minutes }))} />
                </View>
                {byClubSum > service.minutes ? <Txt style={[TYPE.tiny, { marginTop: 5 }]}>Co-hosted events count for each club that put them on, so the clubs add up to more than the total.</Txt> : null}
              </View>
            ) : undefined
          }
          rows={service.entries}
          rowKey={(e) => e.attendanceId}
          empty="No service hours yet. Events that count toward service hours add them when you check in."
          total={["", "Total", serviceEventsLabel(service.events), fmtServiceHours(service.minutes)]}
          columns={[
            { label: "Date", width: 70, cell: (e) => day(e.startsAt) },
            { label: "Event", flex: 1.15, cell: (e) => pdfText(e.title) },
            { label: "Club", cell: (e) => hostLine(e) },
            { label: "Hours", width: 42, align: "right", cell: (e) => fmtServiceHours(e.minutes) },
          ]}
        />

        <TableSection<TermRow>
          title="Clubs and attendance"
          aside={attendance.events ? `${clubEventsLabel(attendance.events)}, by term` : undefined}
          rows={termRows}
          rowKey={(r) => `${r.term}:${r.club.id}`}
          empty="No club events attended yet. Check-ins at club events are counted here by term."
          columns={[
            {
              label: "Term",
              width: 100,
              cell: (r) =>
                r.first ? (
                  <View>
                    <Txt style={TYPE.strong}>{r.term ?? "Earlier"}</Txt>
                    <Txt style={TYPE.tiny}>{clubEventsLabel(r.termEvents)}</Txt>
                  </View>
                ) : (
                  ""
                ),
            },
            { label: "Club", cell: (r) => pdfText(r.club.name) },
            { label: "Attended as", width: 76, cell: (r) => (r.asMember ? "Member" : "Guest") },
            { label: "Events", width: 46, align: "right", cell: (r) => r.events.toLocaleString("en-US") },
          ]}
        />

        <TableSection<RecordCompletion>
          title="WSUSA trainings and requirements"
          aside={record.completed.length ? `${required} required by WSUSA` : undefined}
          rows={record.completed}
          rowKey={(c) => c.id}
          empty="Nothing completed yet. WSUSA trainings, workshops, tests and forms are listed here once done."
          columns={[
            { label: "Date", width: 70, cell: (c) => day(c.at) },
            {
              label: "Completed",
              cell: (c) => (
                <View>
                  <Txt>{pdfText(c.name)}</Txt>
                  {c.required ? <Txt style={[TYPE.tiny, { color: COLORS.brand }]}>Required by WSUSA</Txt> : null}
                </View>
              ),
            },
            { label: "What", width: 110, cell: (c) => COMPLETION_LABEL[c.kind] },
          ]}
        />

        <Txt style={[TYPE.tiny, { marginTop: 18 }]}>
          {`Every number on this record is counted from ${PLATFORM.name}, ${INSTITUTION.name}'s platform for student clubs: leadership from club org charts, service hours and attendance from event check-ins, and requirements from WSUSA's trainings, tests and forms.`}
        </Txt>
      </DocPage>
    </Document>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { key: string; label: string; minutes: number }[] }) {
  return (
    <View style={{ flex: 1 }}>
      <Txt style={[TYPE.label, { marginBottom: 3 }]}>{title.toUpperCase()}</Txt>
      {rows.map((r) => (
        <View key={r.key} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5, borderBottomWidth: 0.4, borderBottomColor: COLORS.line }}>
          <Txt style={{ fontSize: 8.5, lineHeight: 1.3, flex: 1, paddingRight: 6 }}>{r.label}</Txt>
          <Txt style={{ fontSize: 8.5, lineHeight: 1.3, fontFamily: "Helvetica-Bold" }}>{`${fmtServiceHours(r.minutes)} ${hoursWord(r.minutes)}`}</Txt>
        </View>
      ))}
    </View>
  );
}

export async function renderInvolvementPdf(record: InvolvementRecord, verify: DocumentVerification): Promise<Buffer> {
  return renderToBuffer(<InvolvementPdf record={record} verify={verify} />);
}
