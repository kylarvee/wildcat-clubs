"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import type { CohostStatus, EventKind, FundingSource, LocationType, Recurrence, Visibility } from "@prisma/client";
import { AlertTriangle, Ban, CalendarCheck, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";
import { RichTextEditor } from "@/components/rich/RichTextEditor";
import type { PickedFile } from "@/components/files/FilePicker";
import { WhenFields } from "@/components/events/WhenFields";
import { LocationFields, EMPTY_LOCATION, type BuildingOption, type LocationValue } from "@/components/events/LocationFields";
import { CostsEditor, costRowsError, newCostKey, type CostRowValue } from "@/components/events/CostsEditor";
import { CohostPicker, type ClubOption } from "@/components/events/CohostPicker";
import { AttachmentsField } from "@/components/events/AttachmentsField";
import { defaultWhen, previewOccurrences, termsFromJson, toSchedule, whenFrom, whenFromEvent, type WhenValue } from "@/components/events/when";
import { EVENT_KINDS, KIND_LABEL, VISIBILITY_HINT, VISIBILITY_LABEL } from "@/lib/events/labels";
import type { EventLink } from "@/lib/events/links";
import type { TermJson } from "@/lib/events/types";
import { cancelEventAction, createEventAction, deleteEventAction, restoreEventAction, updateEventAction } from "@/app/events/actions";

export type EditorEvent = {
  id: string;
  status: "DRAFT" | "SCHEDULED" | "CANCELLED";
  title: string;
  kind: EventKind;
  /** Description without the links block (see lib/events/links). */
  descriptionHtml: string;
  links: EventLink[];
  visibility: Visibility;
  allowSelfCheckIn: boolean;
  startsAt: string | null;
  durationMinutes: number;
  allDay: boolean;
  recurrence: Recurrence;
  recurrenceInterval: number;
  recurrenceWeekdays: number[];
  recurrenceUntil: string | null;
  recurrenceCount: number | null;
  locationType: LocationType;
  buildingId: string | null;
  room: string | null;
  address: string | null;
  virtualUrl: string | null;
  cohostAllClubs: boolean;
  cohosts: { clubId: string; status: CohostStatus }[];
  attachments: PickedFile[];
  costs: { id: string; description: string; category: string; quantity: number; unitCostCents: number; perOccurrence: boolean; fundingSource: FundingSource }[];
  attendanceCount: number;
  /** Set when an officer requirement points at this training. */
  requirementName: string | null;
};

export type EventEditorProps = {
  mode: "club" | "university";
  club: { id: string; slug: string; name: string } | null;
  /** Where Save and Cancel go back to (the Events Builder or admin trainings). */
  basePath: string;
  event: EditorEvent | null;
  /** Prefill for new events (from a calendar selection). */
  initial?: { start?: string; end?: string; allDay?: boolean; title?: string };
  buildings: BuildingOption[];
  clubs: ClubOption[];
  terms: TermJson[];
  googleLive: boolean;
  defaultFundingSource: FundingSource;
};

const SECTIONS = [
  { id: "basics", label: "Basics" },
  { id: "when", label: "When" },
  { id: "where", label: "Where" },
  { id: "details", label: "Details" },
  { id: "attachments", label: "Attachments" },
  { id: "costs", label: "Costs", club: true },
  { id: "cohosts", label: "Co-hosts", club: true },
  { id: "visibility", label: "Visibility & check-in" },
  { id: "danger", label: "Cancel or delete", existing: true },
];

function initialWhen(p: EventEditorProps): WhenValue {
  if (p.event?.startsAt) return whenFromEvent({ ...p.event, startsAt: p.event.startsAt });
  if (p.initial?.start) {
    const s = new Date(p.initial.start);
    const e = p.initial.end ? new Date(p.initial.end) : new Date(s.getTime() + 3_600_000);
    if (!Number.isNaN(s.getTime())) return whenFrom(s, Math.max(5, Math.round((e.getTime() - s.getTime()) / 60_000)), Boolean(p.initial.allDay));
  }
  return defaultWhen();
}

function initialLocation(e: EditorEvent | null): LocationValue {
  if (!e) return EMPTY_LOCATION;
  return { locationType: e.locationType, buildingId: e.buildingId ?? "", room: e.room ?? "", address: e.address ?? "", virtualUrl: e.virtualUrl ?? "", createMeetLink: false };
}

/**
 * The full Events Builder editor (club and university mode). One Save writes
 * everything — schedule, place, details, attachments, costs and co-hosts —
 * through the events domain functions.
 */
export function EventEditor(props: EventEditorProps) {
  const { mode, club, basePath, event, buildings, clubs, terms, googleLive, defaultFundingSource } = props;
  const router = useRouter();
  const id = useId();
  const isClub = mode === "club" && club !== null;
  const isIdea = event?.status === "DRAFT";

  const [title, setTitle] = useState(event?.title ?? props.initial?.title ?? "");
  const [kind, setKind] = useState<EventKind>(event?.kind ?? (isClub ? "MEETING" : "TRAINING"));
  const [description, setDescription] = useState(event?.descriptionHtml ?? "");
  const [visibility, setVisibility] = useState<Visibility>(event?.visibility ?? (isClub ? "PUBLIC" : "UNIVERSITY"));
  const [selfCheckIn, setSelfCheckIn] = useState(event?.allowSelfCheckIn ?? true);
  const [when, setWhen] = useState<WhenValue>(() => initialWhen(props));
  const [location, setLocation] = useState<LocationValue>(() => initialLocation(event));
  const [files, setFiles] = useState<PickedFile[]>(event?.attachments ?? []);
  const [links, setLinks] = useState<EventLink[]>(event?.links ?? []);
  const [costs, setCosts] = useState<CostRowValue[]>(
    () =>
      event?.costs.map((c) => ({
        key: c.id,
        id: c.id,
        description: c.description,
        category: c.category,
        quantity: String(c.quantity),
        unitCost: (c.unitCostCents / 100).toFixed(2),
        perOccurrence: c.perOccurrence,
        fundingSource: c.fundingSource,
      })) ?? [],
  );
  const statuses = useMemo(() => Object.fromEntries((event?.cohosts ?? []).map((c) => [c.clubId, c.status])) as Record<string, CohostStatus>, [event]);
  const [cohostAll, setCohostAll] = useState(event?.cohostAllClubs ?? false);
  const [cohostIds, setCohostIds] = useState<string[]>(event && !event.cohostAllClubs ? event.cohosts.map((c) => c.clubId) : []);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, startSaving] = useTransition();
  const [busy, startBusy] = useTransition();
  const [cancelReason, setCancelReason] = useState("");

  const termRows = useMemo(() => termsFromJson(terms), [terms]);
  const meetings = useMemo(() => previewOccurrences(when, termRows).length, [when, termRows]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const touch =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      setDirty(true);
      fn(v);
    };

  function fail(message: string, section?: string) {
    setError(message);
    toast.error(message);
    if (section) document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function save() {
    setError(null);
    if (!title.trim()) return fail("Give the event a title.", "basics");
    const sched = toSchedule(when);
    if (!sched.ok) return fail(sched.error, "when");
    if (location.locationType === "CAMPUS" && !location.buildingId) return fail("Pick the campus building.", "where");
    if (location.locationType === "ADDRESS" && !location.address.trim()) return fail("Add the address so people can find it.", "where");
    if (location.locationType === "VIRTUAL" && !location.virtualUrl.trim() && !location.createMeetLink) return fail("Add the link people use to join, or ask for a Google Meet link.", "where");
    if (isClub) {
      const costError = costRowsError(costs);
      if (costError) return fail(costError, "costs");
    }
    const payload = {
      title: title.trim(),
      kind,
      descriptionHtml: description,
      links,
      visibility,
      allowSelfCheckIn: selfCheckIn,
      attachmentFileIds: files.map((f) => f.id),
      cohostClubIds: isClub ? cohostIds : [],
      cohostAllClubs: isClub ? cohostAll : false,
      costs: isClub
        ? costs.map((c) => ({
            id: c.id,
            description: c.description.trim(),
            category: c.category,
            quantity: Number(c.quantity),
            unitCost: Number(c.unitCost),
            perOccurrence: c.perOccurrence,
            fundingSource: c.fundingSource,
          }))
        : undefined,
      ...sched.value,
      locationType: location.locationType,
      buildingId: location.buildingId || null,
      room: location.room,
      address: location.address,
      virtualUrl: location.virtualUrl.trim(),
      createMeetLink: location.createMeetLink,
    };
    startSaving(async () => {
      const res = event ? await updateEventAction(event.id, payload) : await createEventAction({ ...payload, clubId: club?.id ?? null });
      if (!res.ok) return fail(res.error);
      setDirty(false);
      toast.success(isIdea ? "Added to the calendar" : event ? "Event saved" : "Event created");
      if (res.data.google.status === "failed" && res.data.google.message) toast.warning(res.data.google.message);
      router.push(`${basePath}?date=${when.date}`);
      router.refresh();
    });
  }

  function runDanger(fn: () => Promise<{ ok: boolean; error?: string }>, done: string, leave = false) {
    startBusy(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Something went wrong.");
      toast.success(done);
      if (leave) {
        setDirty(false);
        router.push(basePath);
      }
      router.refresh();
    });
  }

  const sections = SECTIONS.filter((s) => (!s.club || isClub) && (!s.existing || event));
  const blockedDelete = event ? (event.attendanceCount > 0 ? "People already checked in, so it can only be cancelled — its attendance history stays." : event.requirementName ? `This training is the officer requirement “${event.requirementName}”. Change the requirement first.` : null) : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[180px_1fr]">
      <nav aria-label="Editor sections" className="hidden xl:block">
        <ul className="sticky top-20 space-y-1 text-sm">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="block rounded-md px-2 py-1 text-ink-3 hover:bg-muted hover:text-ink">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <form
        className="min-w-0 space-y-5 pb-24"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onChange={() => setDirty(true)}
        noValidate
      >
        {error ? (
          <Callout tone="danger" title="Couldn't save yet" icon={<AlertTriangle />}>
            {error}
          </Callout>
        ) : null}
        {isIdea ? (
          <Callout tone="brand" title="This is an idea">
            Pick a time below and save to put it on the calendar.
          </Callout>
        ) : null}
        {event?.status === "CANCELLED" ? (
          <Callout tone="warning" title="This event is cancelled">
            It stays on calendars, crossed out. Restore it under “Cancel or delete” to bring it back.
          </Callout>
        ) : null}

        <Card id="basics" className="scroll-mt-20">
          <CardHeader title="Basics" />
          <CardBody className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-title`}>
                Title <span className="text-danger">*</span>
              </Label>
              <Input id={`${id}-title`} value={title} maxLength={140} required placeholder={isClub ? "e.g. Weekly build night" : "e.g. Officer training: running a club budget"} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-kind`}>Type</Label>
              <Select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as EventKind)}>
                {EVENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </div>
          </CardBody>
        </Card>

        <Card id="when" className="scroll-mt-20">
          <CardHeader title="When" description="One-time or repeating. Past meetings and meetings with check-ins never change." />
          <CardBody>
            <WhenFields value={when} onChange={touch(setWhen)} terms={terms} />
          </CardBody>
        </Card>

        <Card id="where" className="scroll-mt-20">
          <CardHeader title="Where" />
          <CardBody>
            <LocationFields value={location} onChange={touch(setLocation)} buildings={buildings} googleLive={googleLive} />
          </CardBody>
        </Card>

        <Card id="details" className="scroll-mt-20">
          <CardHeader title="Details" description="Agenda, what to bring, who it's for." />
          <CardBody>
            <RichTextEditor
              name="descriptionHtml"
              defaultValue={event?.descriptionHtml ?? ""}
              onChange={(html) => {
                setDirty(true);
                setDescription(html);
              }}
              clubId={club?.id ?? null}
              placeholder="What should people know before they come?"
              minHeight={180}
            />
          </CardBody>
        </Card>

        <Card id="attachments" className="scroll-mt-20">
          <CardHeader title="Attachments" />
          <CardBody>
            <AttachmentsField clubId={club?.id ?? null} files={files} onFilesChange={touch(setFiles)} links={links} onLinksChange={touch(setLinks)} />
          </CardBody>
        </Card>

        {isClub ? (
          <Card id="costs" className="scroll-mt-20">
            <CardHeader title="Costs" description="Expected spending for this event. Leaders see it on calendars; members don't." />
            <CardBody>
              <CostsEditor rows={costs} onChange={touch(setCosts)} meetings={meetings} defaultSource={defaultFundingSource} budgetHref={club ? `/clubs/${club.slug}/manage/budget` : null} />
            </CardBody>
          </Card>
        ) : null}

        {isClub ? (
          <Card id="cohosts" className="scroll-mt-20">
            <CardHeader title="Co-hosts" description="Plan it with other clubs. Their leaders approve before it shows on their calendar." />
            <CardBody>
              <CohostPicker clubs={clubs} value={cohostIds} onChange={touch(setCohostIds)} all={cohostAll} onAllChange={touch(setCohostAll)} statuses={statuses} />
            </CardBody>
          </Card>
        ) : null}

        <Card id="visibility" className="scroll-mt-20">
          <CardHeader title="Visibility & check-in" />
          <CardBody className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink">Who can see it</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(isClub ? (["PUBLIC", "UNIVERSITY", "MEMBERS"] as Visibility[]) : (["PUBLIC", "UNIVERSITY"] as Visibility[])).map((v) => (
                  <label
                    key={v}
                    className={cn(
                      "flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand",
                      visibility === v ? "border-brand bg-brand-50" : "border-line-2 hover:bg-muted",
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium text-ink">
                      <input type="radio" name={`${id}-vis`} className="accent-[var(--color-brand)]" checked={visibility === v} onChange={() => setVisibility(v)} />
                      {VISIBILITY_LABEL[v]}
                    </span>
                    <span className="text-ink-3">{v === "UNIVERSITY" && !isClub ? "Anyone signed in with a Weber State account — officers, members and staff." : VISIBILITY_HINT[v]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Checkbox
              label="Let people check themselves in"
              description="During the event, people can tap “Check in” in the app. Turn this off to require scanning the QR code at the door."
              checked={selfCheckIn}
              onChange={(e) => setSelfCheckIn(e.target.checked)}
            />
          </CardBody>
        </Card>

        {event ? (
          <Card id="danger" className="scroll-mt-20 border-red-200">
            <CardHeader title="Cancel or delete" />
            <CardBody className="space-y-4">
              {event.status === "SCHEDULED" ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="max-w-lg text-sm text-ink-2">Cancelling keeps the event on calendars, crossed out, so people know it isn&apos;t happening. To skip one date, click it on the calendar instead.</p>
                  <ConfirmDialog
                    title="Cancel every upcoming meeting?"
                    description="Past meetings and their attendance stay. Co-host clubs are told."
                    confirmLabel="Cancel event"
                    cancelLabel="Keep it"
                    danger
                    onConfirm={() => runDanger(() => cancelEventAction(event.id, cancelReason), "Event cancelled")}
                    trigger={
                      <Button variant="outline" disabled={busy}>
                        <Ban className="h-4 w-4" /> Cancel event
                      </Button>
                    }
                  >
                    <div className="mt-4 space-y-1.5">
                      <Label htmlFor={`${id}-reason`}>Reason (optional, shown on calendars)</Label>
                      <Textarea id={`${id}-reason`} rows={2} maxLength={300} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Moved to next week because of finals" />
                    </div>
                  </ConfirmDialog>
                </div>
              ) : null}
              {event.status === "CANCELLED" ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-ink-2">Put every upcoming meeting back on the calendar.</p>
                  <Button variant="outline" disabled={busy} onClick={() => runDanger(() => restoreEventAction(event.id), "Event restored")}>
                    <RotateCcw className="h-4 w-4" /> Restore event
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <p className="max-w-lg text-sm text-ink-2">{blockedDelete ?? (isIdea ? "Remove this idea from the list." : "Delete the event and all of its meetings for good.")}</p>
                <ConfirmDialog
                  title={isIdea ? "Delete this idea?" : "Delete this event for good?"}
                  description={isIdea ? undefined : "It disappears from every calendar and feed. This can't be undone."}
                  confirmLabel="Delete"
                  danger
                  onConfirm={() => runDanger(() => deleteEventAction(event.id), isIdea ? "Idea deleted" : "Event deleted", true)}
                  trigger={
                    <Button variant="danger" disabled={busy || Boolean(blockedDelete)}>
                      <Trash2 className="h-4 w-4" /> {isIdea ? "Delete idea" : "Delete event"}
                    </Button>
                  }
                />
              </div>
            </CardBody>
          </Card>
        ) : null}

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-[var(--shadow-pop)] backdrop-blur">
          {dirty ? <Badge tone="warning" className="mr-auto">Unsaved changes</Badge> : null}
          <ButtonLink variant="ghost" href={basePath}>
            Back to calendar
          </ButtonLink>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
            {saving ? "Saving…" : isIdea ? "Add to calendar" : event ? "Save changes" : "Create event"}
          </Button>
        </div>
        {!event ? (
          <p className="text-center text-xs text-ink-3">
            Just an idea for now?{" "}
            <Link href={`${basePath}?tab=ideas`} className="font-medium text-brand-600 hover:underline">
              Add it to the idea list
            </Link>{" "}
            instead.
          </p>
        ) : null}
      </form>
    </div>
  );
}
