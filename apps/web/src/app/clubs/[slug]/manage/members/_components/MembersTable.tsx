"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ClipboardCheck, LifeBuoy, MoreHorizontal, Search, UserMinus, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/layout";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

import { TitleCell } from "./TitleCell";
import { EmergencyContactDialog } from "@/components/details/EmergencyContactDialog";
import { removeFromClub, revealEmergencyContactAction } from "../actions";
import type { MemberRow } from "./types";

type Filter = "current" | "active" | "inactive" | "leaders" | "alumni" | "former";
type SortKey = "name" | "joined" | "attended" | "last";

const FILTERS: { key: Filter; label: string; test: (r: MemberRow) => boolean }[] = [
  { key: "current", label: "All members", test: (r) => r.status === "ACTIVE" },
  { key: "active", label: "Attending", test: (r) => r.status === "ACTIVE" && r.active },
  { key: "inactive", label: "Not attending lately", test: (r) => r.status === "ACTIVE" && !r.active },
  { key: "leaders", label: "Leaders", test: (r) => r.status === "ACTIVE" && r.roles.length > 0 },
  { key: "alumni", label: "Alumni", test: (r) => r.status === "ALUMNI" },
  { key: "former", label: "Former", test: (r) => r.status === "LEFT" || r.status === "REMOVED" },
];

const STATUS_BADGE: Partial<Record<MemberRow["status"], { label: string; tone: "neutral" | "info" | "danger" }>> = {
  ALUMNI: { label: "Alumni", tone: "info" },
  LEFT: { label: "Left", tone: "neutral" },
  REMOVED: { label: "Removed", tone: "danger" },
};

/** The roster: search, filters, sortable columns, inline titles and removal. Table on desktop, cards on phones. */
export function MembersTable({
  slug,
  clubId,
  clubName,
  rows,
  canEditTitles,
  activeRule,
}: {
  slug: string;
  clubId: string;
  clubName: string;
  rows: MemberRow[];
  canEditTitles: boolean;
  /** The sysadmin-set "active student" rule (lib/config), so the note matches it. */
  activeRule: { windowDays: number; recentEvents: number };
}) {
  const [filter, setFilter] = useState<Filter>("current");
  const [emergencyFor, setEmergencyFor] = useState<MemberRow | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [removing, setRemoving] = useState<MemberRow | null>(null);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter(f.test).length])) as Record<Filter, number>, [rows]);

  const shown = useMemo(() => {
    const test = FILTERS.find((f) => f.key === filter)!.test;
    const t = q.trim().toLowerCase();
    const list = rows.filter(test).filter((r) => !t || [r.name, r.email, r.handle, r.internalTitle ?? "", ...r.roles.map((x) => x.label)].some((s) => s.toLowerCase().includes(t)));
    const val = (r: MemberRow) => (sort.key === "name" ? r.name.toLowerCase() : sort.key === "joined" ? (r.joinedAt ?? 0) : sort.key === "attended" ? r.attended : (r.lastAttendedAt ?? 0));
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.name.localeCompare(b.name);
    });
  }, [rows, filter, q, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }));
  }

  async function remove(row: MemberRow) {
    const r = await removeFromClub(slug, row.membershipId).catch(() => ({ ok: false as const, error: "We couldn't reach the server. Try again." }));
    if (r.ok) toast.success(`${row.name} was removed from ${clubName}.`);
    else toast.error(r.error);
  }

  // A plain render helper (not a component) so headers keep focus across re-sorts.
  const sortHeader = (k: SortKey, children: React.ReactNode, className?: string) => {
    const on = sort.key === k;
    return (
      <TH className={className} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 uppercase hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
          {children}
          {on ? sort.dir === 1 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden /> : null}
        </button>
      </TH>
    );
  };

  const statusCell = (r: MemberRow) =>
    r.status === "ACTIVE" ? (
      <Badge tone={r.active ? "success" : "neutral"}>{r.active ? "Attending" : "Not attending lately"}</Badge>
    ) : (
      <Badge tone={STATUS_BADGE[r.status]?.tone ?? "neutral"}>{STATUS_BADGE[r.status]?.label ?? r.status}</Badge>
    );

  const rolesCell = (r: MemberRow) =>
    r.roles.length ? (
      <div className="flex flex-wrap gap-1">
        {r.roles.map((x, i) => (
          <Badge key={i} tone={x.role === "PRESIDENT" || x.role === "VP" ? "brand" : x.role === "ADVISOR" ? "info" : "neutral"} title={x.viaClub ? `Placed by ${x.viaClub}` : undefined}>
            {x.label}
          </Badge>
        ))}
      </div>
    ) : (
      <span className="text-sm text-ink-3">Member</span>
    );

  // Year in school and phone come from their member details; a personal email only if they added one.
  const contactLine = (r: MemberRow) => [r.yearLabel, r.phone, r.contactEmail].filter(Boolean).join(" · ");

  const menu = (r: MemberRow) => (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Options for ${r.name}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <Link href={`/clubs/${slug}/manage/attendance/members/${r.userId}`}>
            <ClipboardCheck className="h-4 w-4" aria-hidden /> Attendance record
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/u/${r.handle}`}>
            <Users className="h-4 w-4" aria-hidden /> Profile
          </Link>
        </DropdownMenuItem>
        {r.status === "ACTIVE" && r.hasEmergency && !r.isSelf ? (
          <DropdownMenuItem onSelect={() => setEmergencyFor(r)}>
            <LifeBuoy className="h-4 w-4" aria-hidden /> Emergency contact
          </DropdownMenuItem>
        ) : null}
        {r.status === "ACTIVE" && !r.isSelf ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger disabled={!r.canRemove} onSelect={() => setRemoving(r)}>
              <UserMinus className="h-4 w-4" aria-hidden /> {r.canRemove ? "Remove from club" : (r.removeBlocked ?? "Can't remove")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div role="group" aria-label="Filter members" className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand",
                filter === f.key ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
              )}
            >
              {f.label}
              <span className="text-xs tabular-nums text-ink-3">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative lg:ml-auto lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, role or title" className="pl-9" aria-label="Search members" />
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={
            q
              ? `No one matches “${q}”`
              : filter === "current"
                ? "No members yet"
                : filter === "active"
                  ? "No one has attended lately"
                  : filter === "inactive"
                    ? "Nobody has drifted away"
                    : `No ${FILTERS.find((f) => f.key === filter)!.label.toLowerCase()} members`
          }
          description={
            q
              ? "Try a different name or clear the search."
              : filter === "current"
                ? "Students join from your club page or by checking in at an event. Share your club page to get started."
                : filter === "inactive"
                  ? "Everyone on the roster has attended recently. Nice work."
                  : undefined
          }
        />
      ) : (
        <>
          {/* Phones: cards */}
          <ul className="space-y-3 md:hidden">
            {shown.map((r) => (
              <li key={r.membershipId} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
                <div className="flex items-start gap-3">
                  <Avatar name={r.name} src={r.avatarUrl} color={r.avatarColor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/u/${r.handle}`} className="block truncate font-medium text-ink hover:underline">
                      {r.name}
                    </Link>
                    <p className="truncate text-xs text-ink-3">{r.email}</p>
                    {contactLine(r) ? <p className="truncate text-xs text-ink-3">{contactLine(r)}</p> : null}
                  </div>
                  {statusCell(r)}
                  {menu(r)}
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  {rolesCell(r)}
                  <TitleCell slug={slug} membershipId={r.membershipId} name={r.name} value={r.internalTitle} editable={canEditTitles && r.status === "ACTIVE"} />
                  <p className="text-xs text-ink-3">
                    Joined {r.joinedLabel} · {r.attended} event{r.attended === 1 ? "" : "s"} · last {r.lastAttendedLabel}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {/* Tablet and up: table */}
          <div className="hidden md:block">
            <Table>
              <caption className="sr-only">
                {clubName} members — {FILTERS.find((f) => f.key === filter)!.label}
              </caption>
              <THead>
                <tr>
                  {sortHeader("name", "Member")}
                  <TH>Role</TH>
                  <TH>Title</TH>
                  {sortHeader("joined", "Joined")}
                  {sortHeader("attended", "Events", "text-right")}
                  {sortHeader("last", "Last attended")}
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {shown.map((r) => (
                  <TR key={r.membershipId}>
                    <TD className="max-w-[16rem]">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.name} src={r.avatarUrl} color={r.avatarColor} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/u/${r.handle}`} className="block truncate font-medium hover:underline">
                            {r.name}
                          </Link>
                          <p className="truncate text-xs text-ink-3">{r.email}</p>
                          {contactLine(r) ? <p className="truncate text-xs text-ink-3">{contactLine(r)}</p> : null}
                        </div>
                      </div>
                    </TD>
                    <TD className="max-w-[14rem]">{rolesCell(r)}</TD>
                    <TD className="max-w-[12rem]">
                      <TitleCell slug={slug} membershipId={r.membershipId} name={r.name} value={r.internalTitle} editable={canEditTitles && r.status === "ACTIVE"} />
                    </TD>
                    <TD className="whitespace-nowrap text-ink-2">{r.joinedLabel}</TD>
                    <TD className="text-right tabular-nums">
                      <Link href={`/clubs/${slug}/manage/attendance/members/${r.userId}`} className="hover:underline" aria-label={`${r.attended} events attended — open ${r.name}'s attendance`}>
                        {r.attended}
                      </Link>
                    </TD>
                    <TD className="whitespace-nowrap text-ink-2">{r.lastAttendedLabel}</TD>
                    <TD>{statusCell(r)}</TD>
                    <TD className="w-10 text-right">{menu(r)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <p className="text-xs text-ink-3">
            Showing {shown.length} of {counts[filter]}. &ldquo;Attending&rdquo; means they checked in within {activeRule.windowDays} days or at one of the club&apos;s last {activeRule.recentEvents} events.
          </p>
        </>
      )}

      <EmergencyContactDialog member={emergencyFor} onClose={() => setEmergencyFor(null)} reveal={(userId) => revealEmergencyContactAction(clubId, userId)} />

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? "this member"}?`}
        description={`They leave ${clubName}'s roster and calendar, and any roles they hold end. Their attendance and role history stay on record. If they ask to join again, a leader will need to approve them.`}
        confirmLabel="Remove member"
        danger
        onConfirm={() => {
          if (removing) void remove(removing);
          setRemoving(null);
        }}
      />
    </div>
  );
}
