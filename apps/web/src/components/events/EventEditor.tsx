"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import type { CohostStatus, EventKind, EventPerk, EventReview, EventRisk, EventStatus, FundingSource, LocationType, Recurrence, Visibility } from "@prisma/client";
import { AlertTriangle, Ban, CalendarCheck, CircleCheck, Gift, Hourglass, Loader2, MessageSquareWarning, RotateCcw, Trash2, UtensilsCrossed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { Switch, toast } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";
import { RichTextEditor } from "@/components/rich/RichTextEditor";
import type { PickedFile } from "@/components/files/FilePicker";
import { WhenFields } from "@/components/events/WhenFields";
import { LocationFields, EMPTY_LOCATION, type BuildingOption, type LocationValue } from "@/components/events/LocationFields";
import { CostsEditor, costRowsError, newCostKey, type CostRowValue } from "@/components/events/CostsEditor";
import { CohostPicker, type ClubOption } from "@/components/events/CohostPicker";
import { AttachmentsField } from "@/components/events/AttachmentsField";
import { CoverField } from "@/components/events/CoverField";
import { RiskReviewFields, travelDraft, travelOut, type ReviewSettings, type TravelDraft } from "@/components/events/RiskReviewFields";
import { defaultWhen, previewOccurrences, termsFromJson, toSchedule, whenFrom, whenFromEvent, type WhenValue } from "@/components/events/when";
import { EVENT_KINDS, EVENT_PERKS, KIND_LABEL, PERK_LABEL, VISIBILITY_HINT, VISIBILITY_LABEL } from "@/lib/events/labels";
import { isHttpUrl, type EventLink } from "@/lib/events/links";
import { defaultServiceMinutes, hoursText, QUARTER_HOUR, resolveServiceMinutes } from "@/lib/events/rules";
import { waitingLabel, type TravelPlan } from "@/lib/events/review";
import { fmtDate } from "@/lib/time";
import type { TermJson } from "@/lib/events/types";
import { cancelEventAction, createEventAction, deleteEventAction, restoreEventAction, updateEventAction } from "@/app/events/actions";

export type EditorEvent = {
  id: string;
  status: EventStatus;
  title: string;
  kind: EventKind;
  /** Description without the links block (see lib/events/links). */
  descriptionHtml: string;
  links: EventLink[];
  visibility: Visibility;
  setupMinutes: number;
  cleanupMinutes: number;
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
  /** "/api/files/<id>": one of the host's public image files. */
  coverUrl: string | null;
  perks: EventPerk[];
  /** Minutes each attendee earns per date they check in; null = doesn't count. */
  serviceMinutes: number | null;
  cohostAllClubs: boolean;
  cohosts: { clubId: string; status: CohostStatus }[];
  attachments: PickedFile[];
  /** `lockedBy`: the submitted or approved funding request that covers the line (it can't change). */
  costs: { id: string; description: string; category: string; quantity: number; unitCostCents: number; perOccurrence: boolean; fundingSource: FundingSource; lockedBy: string | null }[];
  attendanceCount: number;
  /** Set when a WSUSA requirement points at this training. */
  requirementName: string | null;
  /** "Does this event involve…" (lib/events/review), and the trip when Travel is one. */
  riskFlags: EventRisk[];
  travel: TravelPlan | null;
  /** Where its review stands, and the office's last note. */
  review: { status: EventReview; note: string | null; reviewedAt: string | null; reviewedBy: string | null };
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
  /** Where uploaded covers go (the club's Flyers folder), from loadEditorData. */
  coverFolderId?: string | null;
  /** Club events: the "Does this event involve…" settings (null for university events, which are never reviewed). */
  review?: ReviewSettings | null;
};

const SECTIONS = [
  { id: "basics", label: "Basics" },
  { id: "cover", label: "Cover image" },
  { id: "when", label: "When" },
  { id: "where", label: "Where" },
  { id: "involves", label: "Safety review", club: true },
  { id: "service", label: "Service hours" },
  { id: "details", label: "Details" },
  { id: "attachments", label: "Attachments" },
  { id: "costs", label: "Costs", club: true },
  { id: "cohosts", label: "Co-hosts", club: true },
  { id: "visibility", label: "Visibility & room time" },
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

/** Minutes → the hours box ("1.5"). */
const toHoursInput = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);

/**
 * The full Events Builder editor (club and university mode). One Save writes
 * everything — schedule, place, details, attachments, costs and co-hosts —
 * through the events domain functions.
 */
export function EventEditor(props: EventEditorProps) {
  const { mode, club, basePath, event, buildings, clubs, terms, googleLive, defaultFundingSource, coverFolderId = null, review = null } = props;
  const router = useRouter();
  const id = useId();
  const isClub = mode === "club" && club !== null;

  const [title, setTitle] = useState(event?.title ?? props.initial?.title ?? "");
  const [kind, setKind] = useState<EventKind>(event?.kind ?? (isClub ? "MEETING" : "TRAINING"));
  const [coverUrl, setCoverUrl] = useState<string | null>(event?.coverUrl ?? null);
  const [perks, setPerks] = useState<EventPerk[]>(event?.perks ?? []);
  // Service hours: what's saved, or on for a new Service project. Until someone flips the switch, it follows the type.
  const [serviceOn, setServiceOn] = useState(event ? event.serviceMinutes != null : kind === "SERVICE");
  const [serviceTouched, setServiceTouched] = useState(false);
  /** The hours box; null follows the event's length. */
  const [serviceHours, setServiceHours] = useState<string | null>(event?.serviceMinutes != null ? toHoursInput(event.serviceMinutes) : null);
  const [description, setDescription] = useState(event?.descriptionHtml ?? "");
  const [visibility, setVisibility] = useState<Visibility>(event?.visibility ?? (isClub ? "PUBLIC" : "UNIVERSITY"));
  const [setupMinutes, setSetupMinutes] = useState(String(event?.setupMinutes ?? 0));
  const [cleanupMinutes, setCleanupMinutes] = useState(String(event?.cleanupMinutes ?? 0));
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
        lockedBy: c.lockedBy,
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
  const [flags, setFlags] = useState<EventRisk[]>(event?.riskFlags ?? []);
  const [travel, setTravel] = useState<TravelDraft>(() => travelDraft(event?.travel ?? null, event?.startsAt ? new Date(event.startsAt) : null));

  const termRows = useMemo(() => termsFromJson(terms), [terms]);
  const meetings = useMemo(() => previewOccurrences(when, termRows).length, [when, termRows]);
  const schedule = useMemo(() => toSchedule(when), [when]);
  const lengthMinutes = schedule.ok ? schedule.value.durationMinutes : null;
  const defaultService = lengthMinutes != null ? defaultServiceMinutes(lengthMinutes) : null;
  const shownHours = serviceHours ?? (defaultService != null ? toHoursInput(defaultService) : "");
  const service = serviceOut();

  /** The minutes a save sends (null = doesn't count), checked by the same rule the write path uses. */
  function serviceOut(): { ok: true; minutes: number | null } | { ok: false; error: string } {
    if (!serviceOn) return { ok: true, minutes: null };
    const hours = Number(shownHours);
    if (!shownHours.trim() || !Number.isFinite(hours) || hours <= 0) {
      return { ok: false, error: lengthMinutes != null && lengthMinutes < QUARTER_HOUR ? "This event is too short to count toward service hours." : "Enter the hours each attendee earns, or turn service hours off." };
    }
    const r = resolveServiceMinutes(Math.round(hours * 60), { durationMinutes: lengthMinutes ?? Number.MAX_SAFE_INTEGER, kind, existing: null });
    return r.ok ? r : { ok: false, error: r.error };
  }

  function changeKind(k: EventKind) {
    setKind(k);
    if (serviceTouched) return;
    // Service projects count by default; a saved event that already counts keeps its hours.
    if (k === "SERVICE") setServiceOn(true);
    else if (!event) setServiceOn(false);
  }

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
    if (location.locationType !== "TBD" && location.virtualUrl.trim() && !isHttpUrl(location.virtualUrl.trim())) return fail("Enter the full online link, starting with https://", "where");
    if (!service.ok) return fail(service.error, "service");
    // Travel checked: the trip goes with it (the write path checks it against the dates).
    const trip = isClub && review && flags.includes("TRAVEL") ? travelOut(travel) : null;
    if (trip && !trip.ok) return fail(trip.error, "involves");
    if (isClub) {
      const costError = costRowsError(costs);
      if (costError) return fail(costError, "costs");
    }
    const payload = {
      title: title.trim(),
      kind,
      coverUrl,
      perks,
      serviceMinutes: service.minutes,
      descriptionHtml: description,
      links,
      visibility,
      setupMinutes: Number(setupMinutes) || 0,
      cleanupMinutes: Number(cleanupMinutes) || 0,
      attachmentFileIds: files.map((f) => f.id),
      cohostClubIds: isClub ? cohostIds : [],
      cohostAllClubs: isClub ? cohostAll : false,
      riskFlags: isClub && review ? flags : undefined,
      travel: trip?.ok ? trip.value : undefined,
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
      const waiting = res.data.review.status === "PENDING";
      toast.success(waiting ? `Saved and sent to ${res.data.review.waitingFor ?? "your club's office"} for review` : event ? "Event saved" : "Event created");
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
  const blockedDelete = event ? (event.attendanceCount > 0 ? "People already checked in, so it can only be cancelled — its attendance history stays." : event.requirementName ? `This training is the WSUSA requirement “${event.requirementName}”. Change the requirement first.` : null) : null;

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
        {event?.status === "CANCELLED" ? (
          <Callout tone="warning" title="This event is cancelled">
            It stays on calendars, crossed out. Restore it under “Cancel or delete” to bring it back.
          </Callout>
        ) : null}
        {isClub && review && event ? <ReviewStatus review={event.review} office={review.office.name} /> : null}

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
              <Select id={`${id}-kind`} value={kind} onChange={(e) => changeKind(e.target.value as EventKind)}>
                {EVENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-medium text-ink">Perks</legend>
              <div className="flex flex-wrap gap-2">
                {EVENT_PERKS.map((p) => {
                  const on = perks.includes(p);
                  const Icon = p === "FREE_FOOD" ? UtensilsCrossed : Gift;
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => touch(setPerks)(on ? perks.filter((x) => x !== p) : [...perks, p])}
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                        on ? "border-green-300 bg-success-50 text-success" : "border-line-2 bg-surface text-ink-2 hover:bg-muted",
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" /> {PERK_LABEL[p]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-ink-3">They show as badges, and people can filter the Events page by them.</p>
            </fieldset>
          </CardBody>
        </Card>

        <Card id="cover" className="scroll-mt-20">
          <CardHeader title="Cover image" description="Shown on event cards and at the top of the event page." />
          <CardBody>
            <CoverField clubId={club?.id ?? null} hostName={club?.name ?? "Weber State"} folderId={coverFolderId} value={coverUrl} onChange={touch(setCoverUrl)} />
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

        {isClub && review ? (
          <Card id="involves" className="scroll-mt-20">
            <CardHeader title="Does this event involve…" description={`Check anything that applies. ${review.office.name} takes a look at events like these before they're posted.`} />
            <CardBody>
              <RiskReviewFields
                flags={flags}
                onFlagsChange={touch((next: EventRisk[]) => {
                  setFlags(next);
                  // Checking Travel starts the trip on the event's own dates.
                  if (next.includes("TRAVEL") && !flags.includes("TRAVEL") && !travel.leaveDate && !travel.returnDate) setTravel((t) => ({ ...t, leaveDate: when.date, returnDate: when.endDate || when.date }));
                })}
                travel={travel}
                onTravelChange={touch(setTravel)}
                settings={review}
                status={event?.review.status ?? null}
                savedFlags={event?.riskFlags ?? []}
              />
            </CardBody>
          </Card>
        ) : null}

        <Card id="service" className="scroll-mt-20">
          <CardHeader title="Service hours" description="Each attendee earns these hours for every date they check in." />
          <CardBody className="space-y-4">
            <div className="flex items-start gap-3">
              <Switch
                id={`${id}-svc`}
                checked={serviceOn}
                aria-describedby={`${id}-svc-hint`}
                onCheckedChange={(on) => {
                  setDirty(true);
                  setServiceTouched(true);
                  setServiceOn(on);
                }}
              />
              <div className="min-w-0">
                <label htmlFor={`${id}-svc`} className="cursor-pointer text-sm font-medium text-ink">
                  This event counts toward service hours
                </label>
                <p id={`${id}-svc-hint`} className="text-xs text-ink-3">
                  {kind === "SERVICE" ? "On by default for service projects." : "Any type of event can count, not just service projects."}
                </p>
              </div>
            </div>
            {serviceOn ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-hours`}>Hours per attendee</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${id}-hours`}
                    type="number"
                    inputMode="decimal"
                    min={0.25}
                    max={lengthMinutes != null ? lengthMinutes / 60 : undefined}
                    step={0.25}
                    value={shownHours}
                    aria-describedby={`${id}-hours-hint`}
                    aria-invalid={!service.ok || undefined}
                    onChange={(e) => setServiceHours(e.target.value)}
                    onBlur={() => {
                      // Snap to the nearest quarter hour (1.3 → 1.25).
                      const h = Number(shownHours);
                      if (shownHours.trim() && Number.isFinite(h) && h > 0) setServiceHours(String(Math.max(0.25, Math.round(h * 4) / 4)));
                    }}
                    className="w-28"
                  />
                  <span className="text-sm text-ink-2">hours</span>
                </div>
                <p id={`${id}-hours-hint`} className="text-xs text-ink-3">
                  In quarter hours{lengthMinutes != null ? `, up to ${hoursText(lengthMinutes)} (the event's length)` : ""}.
                </p>
                {!service.ok ? (
                  <p className="text-xs text-danger" role="alert">
                    {service.error}
                  </p>
                ) : null}
              </div>
            ) : null}
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
              <CostsEditor rows={costs} onChange={touch(setCosts)} meetings={meetings} defaultSource={defaultFundingSource} budgetHref={club ? `/clubs/${club.slug}/manage/budget${event ? `?event=${event.id}` : ""}` : null} />
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
          <CardHeader title="Visibility & room time" />
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
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">Room time</legend>
              <p className="text-xs text-ink-3">Extra time you need the room before and after, for setup and cleanup. It isn&apos;t shown as part of the event.</p>
              <div className="flex flex-wrap gap-4">
                <div className="space-y-1">
                  <Label htmlFor={`${id}-setup`}>Setup (minutes)</Label>
                  <Input id={`${id}-setup`} type="number" inputMode="numeric" min={0} max={480} step={5} value={setupMinutes} onChange={(e) => setSetupMinutes(e.target.value)} className="w-28" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${id}-cleanup`}>Cleanup (minutes)</Label>
                  <Input id={`${id}-cleanup`} type="number" inputMode="numeric" min={0} max={480} step={5} value={cleanupMinutes} onChange={(e) => setCleanupMinutes(e.target.value)} className="w-28" />
                </div>
              </div>
            </fieldset>
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
                    description="Past meetings and their attendance stay. Members, followers and co-host clubs are told about meetings in the next two weeks."
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
                <p className="max-w-lg text-sm text-ink-2">{blockedDelete ?? "Delete the event and all of its meetings for good."}</p>
                <ConfirmDialog
                  title="Delete this event for good?"
                  description="It disappears from every calendar and feed. This can't be undone."
                  confirmLabel="Delete"
                  danger
                  onConfirm={() => runDanger(() => deleteEventAction(event.id), "Event deleted", true)}
                  trigger={
                    <Button variant="danger" disabled={busy || Boolean(blockedDelete)}>
                      <Trash2 className="h-4 w-4" /> Delete event
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
            {saving ? "Saving…" : event ? "Save changes" : "Create event"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Where the event's review stands, for its leaders: waiting for the office
 * (hidden until then), sent back with the office's note, or approved (with
 * any condition the office added).
 */
function ReviewStatus({ review, office }: { review: EditorEvent["review"]; office: string }) {
  const when = review.reviewedAt ? fmtDate(review.reviewedAt, "MMM d") : null;
  if (review.status === "PENDING")
    return (
      <Callout tone="info" icon={<Hourglass />} title={waitingLabel({ name: office })}>
        Until {office} approves it, only your club&apos;s leaders and {office} can see it. It isn&apos;t on any calendar yet, nobody gets notices or reminders, and check-in stays closed. You can keep editing; your changes go to them as you save.
      </Callout>
    );
  if (review.status === "CHANGES_REQUESTED")
    return (
      <Callout tone="warning" icon={<MessageSquareWarning />} title={`${office} asked for changes${when ? ` on ${when}` : ""}`}>
        {review.note ? <p className="whitespace-pre-line font-medium">“{review.note}”</p> : null}
        <p>Make the changes and save: that sends it back to {office} for review. It stays hidden until it&apos;s approved.</p>
      </Callout>
    );
  if (review.status === "APPROVED")
    return (
      <Callout tone="success" icon={<CircleCheck />} title={`Approved by ${review.reviewedBy ? `${review.reviewedBy} at ` : ""}${office}${when ? ` on ${when}` : ""}`}>
        {review.note ? <p className="whitespace-pre-line">Their note: “{review.note}”</p> : null}
        <p>Checking something new under “Does this event involve…” or changing the trip sends it back for review.</p>
      </Callout>
    );
  return null;
}
