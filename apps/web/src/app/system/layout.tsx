import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { SideNav } from "@/components/workspace/SideNav";

/** System administrator area. lib/authz: system.* = SYSADMIN only. */
export default async function SystemLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/system");
  if (!can(user, "system.config")) notFound();
  const links = [
    { href: "/system", label: "Platform rules", exact: true },
    { href: "/system/terms", label: "Academic calendar" },
    { href: "/system/integrations", label: "AI & integrations" },
    { href: "/system/admins", label: "Administrators" },
    { href: "/system/outbox", label: "Outbox" },
    { href: "/system/jobs", label: "Scheduled jobs" },
  ];
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-brand">System administration</p>
      <div className="grid gap-6 lg:grid-cols-[210px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <SideNav links={links} label="System tools" />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
