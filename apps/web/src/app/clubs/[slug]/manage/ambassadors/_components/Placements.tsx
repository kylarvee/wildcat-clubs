"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Loader2, Search, UserMinus, UserPlus } from "lucide-react";
import { Avatar, ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { Callout, EmptyState } from "@/components/ui/layout";
import { PersonPicker, type PickerPerson } from "@/components/roles/PersonPicker";
import { useRunAction } from "@/components/roles/useRunAction";
import { endPlacement, place } from "../actions";

export type PlacedAmbassador = { assignmentId: string; userId: string; name: string; handle: string; avatarUrl: string | null; avatarColor: string; sinceLabel: string };
export type CollegeClub = { id: string; name: string; slug: string; logoUrl: string | null; logoColor: string; shortDescription: string; members: number; placed: PlacedAmbassador[] };
export type Rep = PickerPerson & { placements: number };

/** The college's clubs with their placed ambassadors; place or end placements inline. */
export function Placements({ orgId, orgName, clubs, reps }: { orgId: string; orgName: string; clubs: CollegeClub[]; reps: Rep[] }) {
  const [q, setQ] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return clubs.filter((c) => (!onlyOpen || c.placed.length === 0) && (!t || c.name.toLowerCase().includes(t) || c.placed.some((p) => p.name.toLowerCase().includes(t))));
  }, [clubs, q, onlyOpen]);
  const openCount = clubs.filter((c) => c.placed.length === 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clubs or ambassadors" className="pl-9" aria-label="Search clubs or ambassadors" />
        </div>
        <div role="group" aria-label="Show" className="flex gap-1 rounded-xl bg-muted p-1 sm:ml-auto">
          {[
            [false, `All clubs (${clubs.length})`],
            [true, `Needs an ambassador (${openCount})`],
          ].map(([v, label]) => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={onlyOpen === v}
              onClick={() => setOnlyOpen(v as boolean)}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand", onlyOpen === v ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink")}
            >
              {label as string}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<Building2 />} title={q ? `No clubs match “${q}”` : onlyOpen ? "Every club has an ambassador" : "No active clubs in this college yet"} description={onlyOpen && !q ? "Nice work — every approved club in the college has a representative." : undefined} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {shown.map((c) => (
            <li key={c.id} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start gap-3">
                <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link href={`/clubs/${c.slug}`} className="block truncate font-medium text-ink hover:underline">
                    {c.name}
                  </Link>
                  <p className="truncate text-xs text-ink-3">{c.shortDescription || `${c.members} member${c.members === 1 ? "" : "s"}`}</p>
                </div>
                {c.placed.length === 0 ? <Badge tone="warning">No ambassador</Badge> : null}
              </div>
              {c.placed.length ? (
                <ul className="space-y-2">
                  {c.placed.map((p) => (
                    <li key={p.assignmentId} className="flex items-center gap-2.5">
                      <Avatar name={p.name} src={p.avatarUrl} color={p.avatarColor} size="xs" />
                      <span className="min-w-0 flex-1 text-sm">
                        <Link href={`/u/${p.handle}`} className="font-medium text-ink hover:underline">
                          {p.name}
                        </Link>{" "}
                        <span className="text-xs text-ink-3">since {p.sinceLabel}</span>
                      </span>
                      <EndPlacementButton assignmentId={p.assignmentId} name={p.name} clubName={c.name} />
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-auto">
                <PlaceDialog orgId={orgId} orgName={orgName} club={c} reps={reps} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlaceDialog({ orgId, orgName, club, reps }: { orgId: string; orgName: string; club: CollegeClub; reps: Rep[] }) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const { pending, error, setError, run } = useRunAction();
  const placedIds = new Set(club.placed.map((p) => p.userId));
  const people = reps.map((r) => ({
    ...r,
    disabledReason: placedIds.has(r.id) ? `Already placed in ${club.name}` : undefined,
    note: r.placements ? `Placed in ${r.placements} club${r.placements === 1 ? "" : "s"}` : "Not placed yet",
  }));
  const person = reps.find((r) => r.id === userId);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setUserId(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant={club.placed.length ? "ghost" : "secondary"} size="sm" disabled={reps.length === 0}>
          <UserPlus className="h-4 w-4" aria-hidden /> {club.placed.length ? "Place another" : "Place an ambassador"}
        </Button>
      </DialogTrigger>
      <DialogContent title={`Place an ambassador in ${club.name}`} description={`They join ${club.name}'s org chart as its College Ambassador, placed by ${orgName}. They get no club permissions unless the club grants some.`}>
        <PersonPicker people={people} value={userId} onChange={setUserId} label="Choose a club representative ambassador" emptyText="No one holds a Club Representative Ambassador seat yet." />
        {error ? (
          <Callout tone="danger" className="mt-4">
            {error}
          </Callout>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!userId || pending}
            onClick={async () => {
              if (!userId) return;
              const r = await run(() => place({ orgId, clubId: club.id, userId }), { success: `${person?.name ?? "They"} now represents the college in ${club.name}.` });
              if (r.ok) {
                setOpen(false);
                setUserId(null);
              }
            }}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Place {person?.name.split(" ")[0] ?? "ambassador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EndPlacementButton({ assignmentId, name, clubName }: { assignmentId: string; name: string; clubName: string }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" className="text-ink-3 hover:text-danger" disabled={pending} aria-label={`End ${name}'s placement in ${clubName}`}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserMinus className="h-4 w-4" aria-hidden />}
          <span className="hidden sm:inline">End</span>
        </Button>
      }
      title={`End ${name}'s placement?`}
      description={`${name} stops being ${clubName}'s College Ambassador today. They stay a member there, and the placement stays in the club's role history.`}
      confirmLabel="End placement"
      danger
      onConfirm={() => {
        void run(() => endPlacement(assignmentId), { success: `Ended ${name}'s placement in ${clubName}.`, toastError: true });
      }}
    />
  );
}
