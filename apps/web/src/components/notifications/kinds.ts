import {
  AlarmClock,
  Award,
  Bell,
  CalendarClock,
  CalendarDays,
  CalendarX2,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardClock,
  FileText,
  GraduationCap,
  Handshake,
  Megaphone,
  MessageSquare,
  ShieldAlert,
  SquarePen,
  Star,
  UserCheck,
  UserPlus,
  UserRoundX,
  Vote,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * An icon for each kind of notification ("event.cohost_request" → handshake),
 * matched on the most specific prefix. Pure and client-safe. The kinds
 * themselves are listed in catalog.ts.
 */
const ICONS: [prefix: string, icon: LucideIcon][] = [
  ["event.cohost", Handshake],
  ["event.starting_soon", AlarmClock],
  ["event.cancelled", CalendarX2],
  ["event.changed", CalendarClock],
  ["event.", CalendarDays],
  ["announcement.", Megaphone],
  ["message.", MessageSquare],
  ["membership.requested", UserPlus],
  ["membership.", UserCheck],
  ["role.", Award],
  ["staffing.", UserRoundX],
  ["election.", Vote],
  ["review.bombing", ShieldAlert],
  ["review.unlocked", SquarePen],
  ["review.", Star],
  ["funding.", CircleDollarSign],
  ["invoice.", CircleDollarSign],
  ["task.", ClipboardCheck],
  ["requirement.due_soon", ClipboardClock],
  ["requirement.", ClipboardCheck],
  ["test.", ClipboardCheck],
  ["ambassador.", Handshake],
  ["advisor.", GraduationCap],
  ["profile.alumni", GraduationCap],
  ["club.", FileText],
  ["constitution.", FileText],
  ["complaint.", ShieldAlert],
  ["system.", Wrench],
];

export function notificationIcon(kind: string): LucideIcon {
  return ICONS.find(([p]) => kind === p || kind.startsWith(p))?.[1] ?? Bell;
}

/** Kinds that mean "something went wrong or is overdue" get a warning tint. */
export function isUrgentKind(kind: string): boolean {
  return /(\.overdue|\.missed|\.failed|^review\.bombing|^complaint\.new)$/.test(kind);
}
