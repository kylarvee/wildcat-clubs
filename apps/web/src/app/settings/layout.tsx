import type { ReactNode } from "react";
import { Eye } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { ButtonLink } from "@/components/ui/button";
import { Container, PageHeader } from "@/components/ui/layout";
import { SideNav } from "@/components/workspace/SideNav";

/** Your settings: the profile editor, preferences and graduating. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireUser("/settings");
  const links = [
    { href: "/settings", label: "Profile", exact: true },
    { href: "/settings/experience", label: "Experience" },
    { href: "/settings/education", label: "Education" },
    { href: "/settings/projects", label: "Projects" },
    { href: "/settings/notifications", label: "Notifications & calendar" },
    ...(user.kind === "STUDENT" ? [{ href: "/settings/graduation", label: "Graduation" }] : []),
  ];
  return (
    <Container size="lg">
      <PageHeader
        title="Settings"
        description="Your profile is what other Weber State students, advisors and WSUSA see when they open your name."
        actions={
          <ButtonLink href={`/u/${user.handle}`} variant="outline">
            <Eye className="h-4 w-4" aria-hidden /> View my profile
          </ButtonLink>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <SideNav links={links} label="Settings sections" />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </Container>
  );
}
