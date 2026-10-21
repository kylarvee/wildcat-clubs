import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { adminScope, can } from "@/lib/authz";
import { SideNav } from "@/components/workspace/SideNav";
import { queueFor } from "@/lib/analytics/admin";

/**
 * Administrator area. lib/authz: platform admins (WSUSA staff, sysadmins) see
 * every tool; an office's staff see the office-scoped ones (can()), each
 * filtered to their office's clubs. The WSUSA-only tools don't show for them
 * and their pages 404.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/admin");
  if (!can(user, "admin.access")) notFound();
  // What's waiting in each tool: the same queue as the Overview and the dashboard.
  const queue = await queueFor(user);
  const waiting = queue.bySection;
  const umbrella = adminScope(user).all;
  const links = [
    { href: "/admin", label: "Overview", exact: true, show: true },
    { href: "/admin/analytics", label: "Club analytics", show: can(user, "admin.analytics") },
    { href: "/admin/clubs", label: "Club approvals", count: waiting.clubs, show: can(user, "admin.clubs") },
    { href: "/admin/events", label: "Event reviews", count: waiting.events, show: can(user, "admin.events") },
    { href: "/admin/funding", label: "Funding", count: waiting.funding, show: can(user, "admin.funding") },
    { href: "/admin/policies", label: "Policies", show: can(user, "admin.policies") },
    { href: "/admin/tests", label: "Tests", count: waiting.tests, show: can(user, "admin.tests") },
    { href: "/admin/requirements", label: "Requirements", show: can(user, "admin.tests") || can(user, "admin.trainings") },
    { href: "/admin/trainings", label: "Trainings & events", show: can(user, "admin.trainings") },
    { href: "/admin/announcements", label: "Announcements", show: can(user, "admin.announce") },
    { href: "/admin/complaints", label: "Reports", count: waiting.complaints, show: can(user, "admin.complaints") },
    { href: "/admin/reviews", label: "Review moderation", count: waiting.reviews, show: can(user, "admin.reviews") },
    { href: "/admin/offices", label: "Offices", show: can(user, "admin.offices") },
    { href: "/admin/directory", label: "Directory", show: can(user, "admin.directory") },
    { href: "/files/university", label: "University files", show: umbrella },
    { href: "/admin/users", label: "People", show: can(user, "admin.users") },
  ]
    .filter((l) => l.show)
    .map(({ show: _show, ...l }) => l);
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-brand">{umbrella ? "Administration" : `Administration · ${queue.name}`}</p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <SideNav links={links} label="Admin tools" />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
