import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, GraduationCap, Landmark, Library, MapPin } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { INSTITUTION } from "@/lib/institution";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { Callout, EmptyState, PageHeader } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SearchForm } from "@/components/admin/SearchForm";
import { DeleteDirectoryItemButton, DirectoryItemDialog } from "@/components/admin/directory/DirectoryDialogs";

export const metadata: Metadata = { title: "Directory" };

const TABS = [
  { key: "colleges", label: "Colleges", icon: Landmark },
  { key: "departments", label: "Departments", icon: Library },
  { key: "majors", label: "Majors", icon: GraduationCap },
  { key: "buildings", label: "Buildings", icon: Building2 },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type SP = Promise<Record<string, string | string[] | undefined>>;

/** "3 clubs and 2 majors" — what keeps an entry from being deleted. */
function usage(parts: [number, string][]): string | null {
  const used = parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}${n === 1 ? "" : "s"}`);
  if (!used.length) return null;
  return used.length === 1 ? used[0] : `${used.slice(0, -1).join(", ")} and ${used.at(-1)}`;
}

/**
 * The university directory (admin.directory): colleges, departments, majors
 * and campus buildings that every picker on the platform reads from.
 */
export default async function DirectoryPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser("/admin/directory");
  if (!can(user, "admin.directory")) notFound();
  const sp = await searchParams;
  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || null;
  };
  const tab: TabKey = TABS.find((t) => t.key === str("tab"))?.key ?? "colleges";
  const q = str("q")?.trim().slice(0, 100) ?? "";

  const [colleges, departmentCount, majorCount, buildingCount] = await Promise.all([
    db.college.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.department.count(),
    db.major.count(),
    db.building.count(),
  ]);
  const counts: Record<TabKey, number> = { colleges: colleges.length, departments: departmentCount, majors: majorCount, buildings: buildingCount };

  return (
    <div className="space-y-6">
      <PageHeader title="Directory" description="Colleges, departments, majors and campus buildings. Club profiles, the founding form, student profiles and the Events Builder all pick from these lists." />
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Directory lists">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "colleges" ? "/admin/directory" : `/admin/directory?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", tab === t.key ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink")}
          >
            <t.icon className="h-4 w-4" aria-hidden />
            {t.label}
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-ink-3">{counts[t.key]}</span>
          </Link>
        ))}
      </nav>
      {tab === "colleges" ? <Colleges /> : tab === "departments" ? <Departments q={q} colleges={colleges} /> : tab === "majors" ? <Majors q={q} colleges={colleges} /> : <Buildings q={q} />}
    </div>
  );
}

function Toolbar({ tab, q, noun, children }: { tab: TabKey; q: string | null; noun: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {q !== null ? <SearchForm action="/admin/directory" q={q} keep={{ tab }} label={`Search ${noun}`} placeholder={`Search ${noun}…`} /> : <span />}
      {children}
    </div>
  );
}

async function Colleges() {
  const rows = await db.college.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { departments: true, majors: true, clubs: true } } } });
  return (
    <div className="space-y-4">
      <Toolbar tab="colleges" q={null} noun="colleges">
        <DirectoryItemDialog kind="college" item={null} />
      </Toolbar>
      {rows.length === 0 ? (
        <EmptyState icon={<Landmark />} title="No colleges yet" description="Add Weber State's colleges so clubs, departments and majors can belong to one." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>College</TH>
              <TH className="text-right">Departments</TH>
              <TH className="hidden text-right sm:table-cell">Majors</TH>
              <TH className="text-right">Clubs</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-ink-3">
                    {c.shortName} · <span className="font-mono">{c.slug}</span>
                  </p>
                </TD>
                <TD className="text-right tabular-nums">{c._count.departments}</TD>
                <TD className="hidden text-right tabular-nums sm:table-cell">{c._count.majors}</TD>
                <TD className="text-right tabular-nums">
                  {c._count.clubs ? (
                    <Link href={`/clubs?college=${c.slug}`} className="text-brand-600 hover:underline">
                      {c._count.clubs}
                    </Link>
                  ) : (
                    0
                  )}
                </TD>
                <TD className="whitespace-nowrap text-right">
                  <DirectoryItemDialog kind="college" item={{ kind: "college", id: c.id, name: c.name, shortName: c.shortName }} />
                  <DeleteDirectoryItemButton kind="college" id={c.id} name={c.name} inUse={usage([[c._count.clubs, "club"], [c._count.departments, "department"], [c._count.majors, "major"]])} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

async function Departments({ q, colleges }: { q: string; colleges: { id: string; name: string }[] }) {
  const [rows, requests] = await Promise.all([
    db.department.findMany({
      where: q ? { name: { contains: q, mode: "insensitive" } } : {},
      orderBy: { name: "asc" },
      include: {
        college: { select: { shortName: true, name: true } },
        clubs: { orderBy: { name: "asc" }, select: { id: true, name: true } },
        _count: { select: { majors: true, faculty: true } },
      },
    }),
    db.club.findMany({
      where: { requestedDepartmentName: { not: null }, departmentId: null, status: { notIn: ["RETIRED", "REJECTED"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, requestedDepartmentName: true },
    }),
  ]);
  return (
    <div className="space-y-4">
      {requests.length ? (
        <Callout tone="brand" title={`${requests.length} club${requests.length === 1 ? " is" : "s are"} waiting on a new department`}>
          <ul className="mt-1 space-y-1">
            {requests.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/clubs/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                  {r.name}
                </Link>{" "}
                asked for “{r.requestedDepartmentName}”.
              </li>
            ))}
          </ul>
          <p className="mt-1">Add it from the club&rsquo;s review page, which links the club in the same step.</p>
        </Callout>
      ) : null}
      <Toolbar tab="departments" q={q} noun="departments">
        <DirectoryItemDialog kind="department" item={null} colleges={colleges} />
      </Toolbar>
      {rows.length === 0 ? (
        <EmptyState icon={<Library />} title={q ? `No departments match “${q}”` : "No departments yet"} description={q ? "Try a shorter search." : "Sponsored clubs need a department, so add them here."} />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Department</TH>
              <TH className="hidden md:table-cell">College</TH>
              <TH>Clubs</TH>
              <TH className="hidden text-right sm:table-cell">Majors</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((d) => (
              <TR key={d.id}>
                <TD>
                  <p className="font-medium">{d.name}</p>
                  <p className="text-xs text-ink-3 md:hidden">{d.college?.shortName ?? "No college"}</p>
                </TD>
                <TD className="hidden text-ink-2 md:table-cell">{d.college?.name ?? <span className="text-ink-3">No college</span>}</TD>
                <TD className="min-w-[10rem]">
                  {d.clubs.length ? (
                    <span className="text-sm">
                      {d.clubs.slice(0, 3).map((c, i) => (
                        <span key={c.id}>
                          {i > 0 ? ", " : ""}
                          <Link href={`/admin/clubs/${c.id}`} className="text-brand-600 hover:underline">
                            {c.name}
                          </Link>
                        </span>
                      ))}
                      {d.clubs.length > 3 ? <span className="text-ink-3"> and {d.clubs.length - 3} more</span> : null}
                    </span>
                  ) : (
                    <span className="text-ink-3">None</span>
                  )}
                </TD>
                <TD className="hidden text-right tabular-nums sm:table-cell">{d._count.majors}</TD>
                <TD className="whitespace-nowrap text-right">
                  <DirectoryItemDialog kind="department" item={{ kind: "department", id: d.id, name: d.name, collegeId: d.collegeId }} colleges={colleges} />
                  <DeleteDirectoryItemButton kind="department" id={d.id} name={d.name} inUse={usage([[d.clubs.length, "club"], [d._count.majors, "major"], [d._count.faculty, "faculty or staff profile"]])} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

async function Majors({ q, colleges }: { q: string; colleges: { id: string; name: string }[] }) {
  const [rows, departments] = await Promise.all([
    db.major.findMany({
      where: q ? { name: { contains: q, mode: "insensitive" } } : {},
      orderBy: { name: "asc" },
      include: { college: { select: { shortName: true } }, department: { select: { name: true } }, _count: { select: { students: true, clubs: true } } },
    }),
    db.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, collegeId: true } }),
  ]);
  return (
    <div className="space-y-4">
      <Toolbar tab="majors" q={q} noun="majors">
        <DirectoryItemDialog kind="major" item={null} colleges={colleges} departments={departments} />
      </Toolbar>
      {rows.length === 0 ? (
        <EmptyState icon={<GraduationCap />} title={q ? `No majors match “${q}”` : "No majors yet"} description={q ? "Try a shorter search." : "Students list majors and minors on their profiles, and clubs pick a focus major."} />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Major</TH>
              <TH className="hidden md:table-cell">Department</TH>
              <TH className="text-right">Students</TH>
              <TH className="hidden text-right sm:table-cell">Clubs</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((m) => (
              <TR key={m.id}>
                <TD>
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-ink-3">{m.college?.shortName ?? "No college"}</p>
                </TD>
                <TD className="hidden text-ink-2 md:table-cell">{m.department?.name ?? <span className="text-ink-3">—</span>}</TD>
                <TD className="text-right tabular-nums">{m._count.students}</TD>
                <TD className="hidden text-right tabular-nums sm:table-cell">{m._count.clubs}</TD>
                <TD className="whitespace-nowrap text-right">
                  <DirectoryItemDialog kind="major" item={{ kind: "major", id: m.id, name: m.name, collegeId: m.collegeId, departmentId: m.departmentId }} colleges={colleges} departments={departments} />
                  <DeleteDirectoryItemButton kind="major" id={m.id} name={m.name} inUse={usage([[m._count.clubs, "club"], [m._count.students, "student profile"]])} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

async function Buildings({ q }: { q: string }) {
  const rows = await db.building.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: [{ campus: "asc" }, { name: "asc" }],
    include: { _count: { select: { events: true } } },
  });
  return (
    <div className="space-y-4">
      <Toolbar tab="buildings" q={q} noun="buildings">
        <DirectoryItemDialog kind="building" item={null} mapsSuffix={INSTITUTION.mapsSuffix} />
      </Toolbar>
      {rows.length === 0 ? (
        <EmptyState icon={<Building2 />} title={q ? `No buildings match “${q}”` : "No buildings yet"} description={q ? "Search by name or code." : "Campus buildings let event planners drop an exact pin on the map."} />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Building</TH>
              <TH className="hidden md:table-cell">Address</TH>
              <TH className="hidden sm:table-cell">Pin</TH>
              <TH className="text-right">Events</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((b) => (
              <TR key={b.id}>
                <TD>
                  <p className="font-medium">
                    <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-ink-2">{b.code}</span>
                    {b.name}
                  </p>
                  <p className="text-xs text-ink-3">{b.campus} campus</p>
                </TD>
                <TD className="hidden text-ink-2 md:table-cell">{b.address ?? <span className="text-ink-3">—</span>}</TD>
                <TD className="hidden sm:table-cell">
                  {b.lat != null && b.lng != null ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
                    >
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      <span className="tabular-nums">
                        {b.lat.toFixed(4)}, {b.lng.toFixed(4)}
                      </span>
                    </a>
                  ) : (
                    <Badge tone="warning">No coordinates</Badge>
                  )}
                </TD>
                <TD className="text-right tabular-nums">{b._count.events}</TD>
                <TD className="whitespace-nowrap text-right">
                  <DirectoryItemDialog
                    kind="building"
                    item={{ kind: "building", id: b.id, code: b.code, name: b.name, campus: b.campus, address: b.address, lat: b.lat, lng: b.lng }}
                    mapsSuffix={INSTITUTION.mapsSuffix}
                  />
                  <DeleteDirectoryItemButton kind="building" id={b.id} name={b.name} inUse={usage([[b._count.events, "event"]])} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
