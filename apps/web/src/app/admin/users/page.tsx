import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { PlatformRole, UserKind, UserStatus } from "@prisma/client";
import { ShieldCheck, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { searchUsers } from "@/lib/domain/users";
import { fmtAgo, fmtLongDate } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Stat } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterSelect, Pager } from "@/components/admin/Filters";
import { SearchForm } from "@/components/admin/SearchForm";
import { KIND_LABEL, PLATFORM_ROLE_LABEL, USER_STATUS_LABEL, USER_STATUS_TONE } from "@/components/admin/users/labels";

export const metadata: Metadata = { title: "People" };

const KINDS: UserKind[] = ["STUDENT", "FACULTY_STAFF"];
const ROLES: PlatformRole[] = ["USER", "ADMIN", "SYSADMIN"];
const STATUSES: UserStatus[] = ["ACTIVE", "ALUMNI", "DEACTIVATED"];

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * People (admin.users): find anyone with a Weber State account and open their
 * record. Status changes (graduated, deactivated) happen on the person's page.
 */
export default async function PeoplePage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser("/admin/users");
  if (!can(user, "admin.users")) notFound();
  const sp = await searchParams;
  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || null;
  };
  const pick = <T extends string>(list: T[], v: string | null) => (list.includes(v as T) ? (v as T) : null);

  const q = str("q")?.trim().slice(0, 100) ?? "";
  const kind = pick(KINDS, str("kind"));
  const role = pick(ROLES, str("role"));
  const status = pick(STATUSES, str("status"));
  const page = Math.max(1, Number.parseInt(str("page") ?? "1", 10) || 1);

  const [result, byStatus, staff] = await Promise.all([
    searchUsers(user, { q, kind, role, status, page }),
    db.user.groupBy({ by: ["status"], _count: { _all: true } }),
    db.user.count({ where: { kind: "FACULTY_STAFF", status: { not: "DEACTIVATED" } } }),
  ]);
  const count = (s: UserStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const filtered = Boolean(q || kind || role || status);

  return (
    <div className="space-y-6">
      <PageHeader
        title="People"
        description="Everyone with a Weber State account on Wildcat Clubs. Open a person to see their clubs and roles, mark a student graduated, or deactivate an account. Nobody is ever deleted — their history belongs to the clubs they served."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active accounts" value={count("ACTIVE").toLocaleString()} />
        <Stat label="Faculty & staff" value={staff.toLocaleString()} hint="not deactivated" />
        <Stat label="Alumni" value={count("ALUMNI").toLocaleString()} />
        <Stat label="Deactivated" value={count("DEACTIVATED").toLocaleString()} hint="can't sign in" />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <SearchForm action="/admin/users" q={q} keep={{ kind, role, status }} label="Search people" placeholder="Name, email or @handle" />
        </div>
        <div className="grid w-full grid-cols-1 gap-3 min-[420px]:grid-cols-3 sm:w-auto">
          <FilterSelect label="Account" param="kind" value={kind} options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} allLabel="Everyone" className="sm:w-40" />
          <FilterSelect label="Platform role" param="role" value={role} options={ROLES.map((r) => ({ value: r, label: PLATFORM_ROLE_LABEL[r] }))} allLabel="Any role" className="sm:w-48" />
          <FilterSelect label="Status" param="status" value={status} options={STATUSES.map((s) => ({ value: s, label: USER_STATUS_LABEL[s] }))} allLabel="Any status" className="sm:w-36" />
        </div>
      </div>

      {result.rows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={q ? `No one matches “${q}”` : "No one matches these filters"}
          description={filtered ? "Try part of their name, their email, or fewer filters." : "People appear here after their first sign-in."}
          action={
            filtered ? (
              <Link href="/admin/users" className="text-sm font-medium text-brand-600 hover:underline">
                Clear search and filters
              </Link>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          <Table>
            <THead>
              <tr>
                <TH>Person</TH>
                <TH className="hidden md:table-cell">Account</TH>
                <TH>Status</TH>
                <TH className="hidden text-right sm:table-cell">Clubs</TH>
                <TH className="hidden text-right sm:table-cell">Roles</TH>
                <TH className="hidden lg:table-cell">Last seen</TH>
              </tr>
            </THead>
            <TBody>
              {result.rows.map((p) => (
                <TR key={p.id}>
                  <TD className="max-w-0 sm:max-w-none">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={p.name} src={p.avatarUrl} color={p.avatarColor} size="sm" />
                      <div className="min-w-0">
                        <Link href={`/admin/users/${p.id}`} className="font-medium text-ink hover:underline">
                          {p.name}
                        </Link>
                        {p.platformRole !== "USER" ? (
                          <Badge tone="brand" className="ml-2 align-middle">
                            <ShieldCheck className="h-3 w-3" aria-hidden /> {p.platformRole === "SYSADMIN" ? "Sysadmin" : "Admin"}
                          </Badge>
                        ) : null}
                        <p className="truncate text-xs text-ink-3">{p.email}</p>
                      </div>
                    </div>
                  </TD>
                  <TD className="hidden text-ink-2 md:table-cell">{KIND_LABEL[p.kind]}</TD>
                  <TD>
                    <Badge tone={USER_STATUS_TONE[p.status]}>{USER_STATUS_LABEL[p.status]}</Badge>
                  </TD>
                  <TD className="hidden text-right tabular-nums sm:table-cell">{p.clubs}</TD>
                  <TD className="hidden text-right tabular-nums sm:table-cell">{p.roles}</TD>
                  <TD className="hidden text-ink-2 lg:table-cell">
                    {p.lastSeenAt ? <time dateTime={p.lastSeenAt.toISOString()} title={fmtLongDate(p.lastSeenAt)}>{fmtAgo(p.lastSeenAt)}</time> : <span className="text-ink-3">Never</span>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pager page={result.page} pages={result.pages} total={result.total} noun="account" />
        </div>
      )}
    </div>
  );
}
