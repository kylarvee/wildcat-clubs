import Link from "next/link";
import { Bell, CheckSquare, MessageSquare } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { countOpenTasks } from "@/lib/domain/tasks";
import { countUnreadConversations } from "@/lib/domain/messaging";
import { aiLive } from "@/lib/config";
import { personasEnabled } from "@/lib/auth/google";
import { Logo } from "@/components/shell/Logo";
import { NavLinks, MobileNav } from "@/components/shell/NavLinks";
import { UserMenu } from "@/components/shell/UserMenu";
import { buttonClasses } from "@/components/ui/button";

function CountDot({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

export async function SiteHeader() {
  const user = await getCurrentUser();
  const [unread, tasks, chats, assistantOn] = user
    ? await Promise.all([db.notification.count({ where: { userId: user.id, readAt: null } }), countOpenTasks(user), countUnreadConversations(user.id), aiLive("assistant")])
    : [0, 0, 0, false];

  const links = user
    ? [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/clubs", label: "Clubs" },
        { href: "/calendar", label: "Calendar" },
        { href: "/network", label: "Network" },
        ...(can(user, "admin.access") ? [{ href: "/admin", label: "Admin" }] : []),
      ]
    : [
        { href: "/clubs", label: "Clubs" },
        { href: "/calendar", label: "Calendar" },
        { href: "/network", label: "Network" },
      ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <MobileNav links={links} />
        <Logo href={user ? "/dashboard" : "/"} />
        <NavLinks links={links} />
        <div className="ml-auto flex items-center gap-1">
          {user ? (
            <>
              <Link href="/messages" className="relative rounded-lg p-2 text-ink-2 hover:bg-muted hover:text-ink" aria-label={chats ? `Messages (${chats} with unread messages)` : "Messages"}>
                <MessageSquare className="h-5 w-5" />
                <CountDot n={chats} />
              </Link>
              <Link href="/tasks" className="relative rounded-lg p-2 text-ink-2 hover:bg-muted hover:text-ink" aria-label={`Tasks (${tasks} open)`}>
                <CheckSquare className="h-5 w-5" />
                <CountDot n={tasks} />
              </Link>
              <Link href="/notifications" className="relative rounded-lg p-2 text-ink-2 hover:bg-muted hover:text-ink" aria-label={`Notifications (${unread} unread)`}>
                <Bell className="h-5 w-5" />
                <CountDot n={unread} />
              </Link>
              <UserMenu
                user={{ name: user.name, email: user.email, handle: user.handle, avatarColor: user.avatarColor, avatarUrl: user.avatarUrl, kind: user.kind }}
                isAdmin={can(user, "admin.access")}
                isSysadmin={can(user, "system.config")}
                personas={personasEnabled()}
                assistantOn={assistantOn}
              />
            </>
          ) : (
            <>
              <Link href="/clubs" className={buttonClasses("ghost", "sm", "hidden sm:inline-flex")}>
                Browse clubs
              </Link>
              <Link href="/login" className={buttonClasses("primary", "sm")}>
                Log in
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
