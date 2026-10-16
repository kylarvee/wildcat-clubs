"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import { Bell, BellRing, CalendarPlus, Check, Clock, Loader2, LogOut, MoreHorizontal, Settings2, UserPlus } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { Switch, toast } from "@/components/ui/misc";
import { useAppPrompt } from "@/components/clubs/AppPrompt";
import { registerClub, setClubSubscription } from "@/app/clubs/actions";
import { leaveClubAction } from "@/app/clubs/[slug]/actions";

/**
 * Register / Subscribe / Leave controls, shared by club cards and the club
 * page hero. State comes from the server; clicks update optimistically and
 * settle to whatever the server re-renders (useOptimistic), so a failed
 * request snaps back on its own.
 */

export type MembershipView = { member: boolean; pending: boolean };

export function loginHref(slug: string, register = false) {
  return `/login?next=${encodeURIComponent(`/clubs/${slug}${register ? "?register=1" : ""}`)}`;
}

type RegisterProps = {
  clubId: string;
  clubName: string;
  slug: string;
  gated: boolean;
  member: boolean;
  pending: boolean;
  signedIn: boolean;
  /** Register once on mount (the ?register=1 hand-off after signing in). */
  autoRegister?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function RegisterButton({ clubId, clubName, slug, gated, member, pending, signedIn, autoRegister, size = "md", className }: RegisterProps) {
  const router = useRouter();
  const { celebrate } = useAppPrompt();
  const [busy, startTransition] = useTransition();
  const [view, setView] = useOptimistic<MembershipView>({ member, pending });
  const ran = useRef(false);
  const label = gated ? "Request to join" : "Register";

  function register(after?: () => void) {
    startTransition(async () => {
      setView(gated ? { member: false, pending: true } : { member: true, pending: false });
      const r = await registerClub(clubId);
      after?.();
      if (!r.ok) {
        if (r.code === "UNAUTHENTICATED") router.push(loginHref(slug, true));
        toast.error(r.error);
        return;
      }
      switch (r.data.status) {
        case "ACTIVE":
          if (!celebrate(clubName)) toast.success(`You're in! Welcome to ${clubName}.`, { description: "Their events are on your calendar now." });
          break;
        case "PENDING":
          toast.success("Request sent", { description: `A ${clubName} leader will review it, and we'll let you know.` });
          break;
        case "ALREADY_MEMBER":
          toast(`You're already a member of ${clubName}.`);
          break;
        case "ALREADY_PENDING":
          toast("Your request is still waiting on a club leader.");
          break;
      }
    });
  }

  // Signed-out visitors who clicked Register come back here with ?register=1.
  useEffect(() => {
    if (!autoRegister || ran.current || !signedIn) return;
    ran.current = true;
    const stripParam = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("register");
      router.replace(url.pathname + url.search + url.hash, { scroll: false });
    };
    if (member || pending) {
      toast(member ? `You're already a member of ${clubName}.` : "Your request is still waiting on a club leader.");
      stripParam();
    } else {
      register(stripParam);
    }
    // Runs once for the hand-off; later prop changes come from the server refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRegister, signedIn]);

  const pill = "inline-flex items-center gap-1.5 rounded-lg font-medium whitespace-nowrap";
  const pillSize = size === "sm" ? "h-8 px-3 text-sm" : size === "lg" ? "h-12 px-5 text-base" : "h-10 px-4 text-sm";

  if (view.member) {
    return (
      <span className={cn(pill, pillSize, "bg-success-50 text-success ring-1 ring-inset ring-green-200", className)}>
        <Check className="h-4 w-4" aria-hidden="true" /> Member
      </span>
    );
  }
  if (view.pending) {
    return (
      <span className={cn(pill, pillSize, "bg-warning-50 text-warning ring-1 ring-inset ring-amber-200", className)} title="A club leader will review your request">
        <Clock className="h-4 w-4" aria-hidden="true" /> Request pending
      </span>
    );
  }
  if (!signedIn) {
    return (
      <ButtonLink href={loginHref(slug, true)} size={size} className={className}>
        <UserPlus className="h-4 w-4" aria-hidden="true" /> {label}
      </ButtonLink>
    );
  }
  return (
    <Button size={size} className={className} onClick={() => register()} disabled={busy} aria-label={`${label} for ${clubName}`}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
      {label}
    </Button>
  );
}

type SubscribeProps = {
  clubId: string;
  clubName: string;
  slug: string;
  subscribed: boolean;
  signedIn: boolean;
  /** "switch" for the club hero, "button" for compact cards. */
  variant?: "switch" | "button";
  className?: string;
};

export function SubscribeToggle({ clubId, clubName, slug, subscribed, signedIn, variant = "button", className }: SubscribeProps) {
  const [busy, startTransition] = useTransition();
  const [on, setOn] = useOptimistic(subscribed);
  const id = useId();

  function toggle(next: boolean) {
    startTransition(async () => {
      setOn(next);
      const r = await setClubSubscription(clubId, next);
      if (!r.ok) toast.error(r.error);
      else toast.success(next ? `${clubName} is on your calendar` : `${clubName} is off your calendar`);
    });
  }

  if (variant === "switch") {
    if (!signedIn) {
      return (
        <Link href={loginHref(slug)} className={cn("inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:underline", className)}>
          <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Log in to add this calendar to yours
        </Link>
      );
    }
    return (
      <div className={cn("flex items-center gap-3 rounded-xl border border-line bg-surface/80 px-3 py-2", className)}>
        <CalendarPlus className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
          <span className="block text-sm font-medium text-ink">On my calendar</span>
          <span className="block text-xs text-ink-3">{on ? "Their events show on your calendar and feeds" : "Follow their events without joining"}</span>
        </label>
        <Switch id={id} checked={on} onCheckedChange={toggle} disabled={busy} aria-label={`Show ${clubName} events on my calendar`} />
      </div>
    );
  }

  if (!signedIn) return null;
  return (
    <Button
      variant={on ? "secondary" : "outline"}
      size="sm"
      onClick={() => toggle(!on)}
      disabled={busy}
      aria-pressed={on}
      aria-label={on ? `Unsubscribe from ${clubName}'s calendar` : `Subscribe to ${clubName}'s calendar`}
      className={className}
    >
      {on ? <BellRing className="h-4 w-4" aria-hidden="true" /> : <Bell className="h-4 w-4" aria-hidden="true" />}
      {on ? "Subscribed" : "Subscribe"}
    </Button>
  );
}

/** "…" menu on the club page: leave the club or cancel a pending request. */
export function MemberMenu({ clubId, clubName, member, pending, manageHref }: { clubId: string; clubName: string; member: boolean; pending: boolean; manageHref?: string | null }) {
  const [confirm, setConfirm] = useState(false);
  const [, startTransition] = useTransition();
  if (!member && !pending && !manageHref) return null;

  function leave() {
    startTransition(async () => {
      const r = await leaveClubAction(clubId);
      if (!r.ok) toast.error(r.error);
      else toast.success(pending ? "Request cancelled" : `You left ${clubName}`);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More membership options">
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {manageHref ? (
            <DropdownMenuItem asChild>
              <Link href={manageHref}>
                <Settings2 className="h-4 w-4" aria-hidden="true" /> Manage club
              </Link>
            </DropdownMenuItem>
          ) : null}
          {member || pending ? (
            <DropdownMenuItem danger onSelect={() => setConfirm(true)}>
              <LogOut className="h-4 w-4" aria-hidden="true" /> {pending ? "Cancel join request" : "Leave club"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        danger
        title={pending ? `Cancel your request to join ${clubName}?` : `Leave ${clubName}?`}
        description={
          pending
            ? "Club leaders won't see your request anymore. You can ask again any time."
            : "You'll stop getting their announcements and their events come off your calendar. Your attendance history stays on your record. If you hold a role, it ends now."
        }
        confirmLabel={pending ? "Cancel request" : "Leave club"}
        cancelLabel={pending ? "Keep request" : "Stay"}
        onConfirm={leave}
      />
    </>
  );
}
