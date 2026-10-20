"use client";

import Link from "next/link";
import { BadgeCheck, CalendarCheck, Flag, FolderOpen, Gavel, GraduationCap, LayoutDashboard, LogOut, Settings, Shield, Sparkles, User, Users, Wrench } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { signOut } from "@/app/login/actions";

export function UserMenu({
  user,
  isAdmin,
  isSysadmin,
  personas,
  assistantOn,
}: {
  user: { name: string; email: string; handle: string; avatarColor: string; avatarUrl: string | null; kind: "STUDENT" | "FACULTY_STAFF" };
  isAdmin: boolean;
  isSysadmin: boolean;
  personas: boolean;
  assistantOn?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="ml-1 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" aria-label="Account menu">
        <Avatar name={user.name} src={user.avatarUrl} color={user.avatarColor} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>
          <span className="block text-sm font-semibold text-ink">{user.name}</span>
          <span className="block truncate font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard"><LayoutDashboard className="h-4 w-4" /> Dashboard</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/u/${user.handle}`}><User className="h-4 w-4" /> My profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/files"><FolderOpen className="h-4 w-4" /> My files</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/me/involvement"><CalendarCheck className="h-4 w-4" /> My involvement</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/tests"><BadgeCheck className="h-4 w-4" /> Tests &amp; forms</Link>
        </DropdownMenuItem>
        {assistantOn ? (
          <DropdownMenuItem asChild>
            <Link href="/assistant"><Sparkles className="h-4 w-4" /> Ask Wildcat Clubs</Link>
          </DropdownMenuItem>
        ) : null}
        {user.kind === "FACULTY_STAFF" ? (
          <DropdownMenuItem asChild>
            <Link href="/advisor"><GraduationCap className="h-4 w-4" /> Advising</Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/constitution"><Gavel className="h-4 w-4" /> Constitution builder</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings"><Settings className="h-4 w-4" /> Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/report"><Flag className="h-4 w-4" /> Report a concern</Link>
        </DropdownMenuItem>
        {isAdmin || isSysadmin ? <DropdownMenuSeparator /> : null}
        {isAdmin ? (
          <DropdownMenuItem asChild>
            <Link href="/admin"><Shield className="h-4 w-4" /> Admin</Link>
          </DropdownMenuItem>
        ) : null}
        {isSysadmin ? (
          <DropdownMenuItem asChild>
            <Link href="/system"><Wrench className="h-4 w-4" /> System settings</Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {personas ? (
          <DropdownMenuItem asChild>
            <Link href="/login?switch=1"><Users className="h-4 w-4" /> Switch test persona</Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
