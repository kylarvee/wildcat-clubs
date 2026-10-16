import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { SideNav } from "@/components/workspace/SideNav";

/** Administrator area (WSUSA staff). lib/authz: admin.* = ADMIN or SYSADMIN. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/admin");
  if (!can(user, "admin.access")) notFound();
  const links = [
    { href: "/admin", label: "Overview", exact: true },
    { href: "/admin/analytics", label: "Club analytics" },
    { href: "/admin/clubs", label: "Club reviews" },
    { href: "/admin/funding", label: "Funding" },
    { href: "/admin/policies", label: "Policies" },
    { href: "/admin/tests", label: "Tests" },
    { href: "/admin/requirements", label: "Officer requirements" },
    { href: "/admin/trainings", label: "Trainings & events" },
    { href: "/admin/announcements", label: "Announcements" },
    { href: "/admin/complaints", label: "Reports" },
    { href: "/admin/reviews", label: "Review moderation" },
    { href: "/admin/directory", label: "Directory" },
    { href: "/admin/users", label: "People" },
  ];
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-brand">Administration</p>
      <div className="grid gap-6 lg:grid-cols-[210px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <SideNav links={links} label="Admin tools" />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
