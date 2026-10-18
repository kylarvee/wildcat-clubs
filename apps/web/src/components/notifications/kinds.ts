import {
  Award,
  Bell,
  BellRing,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Handshake,
  Megaphone,
  MessageSquare,
  ShieldAlert,
  Star,
  UserCheck,
  UserPlus,
  Vote,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * An icon for each kind of notification ("event.cohost_request" → handshake),
 * matched on the most specific prefix. Pure and client-safe.
 */
const ICONS: [prefix: string, icon: LucideIcon][] = [
  ["event.cohost", Handshake],
  ["event.", CalendarDays],
  ["announcement.", Megaphone],
  ["message.", MessageSquare],
  ["membership.requested", UserPlus],
  ["membership.", UserCheck],
  ["role.", Award],
  ["election.", Vote],
  ["review.bombing", ShieldAlert],
  ["review.", Star],
  ["funding.", CircleDollarSign],
  ["invoice.", CircleDollarSign],
  ["task.", ClipboardCheck],
  ["requirement.", ClipboardCheck],
  ["test.", ClipboardCheck],
  ["ambassador.", Handshake],
  ["advisor.", GraduationCap],
  ["profile.alumni", GraduationCap],
  ["club.", FileText],
  ["document.", FileText],
  ["complaint.", ShieldAlert],
  ["system.", Wrench],
  ["reminder.", BellRing],
];

export function notificationIcon(kind: string): LucideIcon {
  return ICONS.find(([p]) => kind === p || kind.startsWith(p))?.[1] ?? Bell;
}

/** Kinds that mean "something went wrong or is overdue" get a warning tint. */
export function isUrgentKind(kind: string): boolean {
  return /(\.overdue|\.missed|\.failed|^review\.bombing|^complaint\.new|^system\.jobs)$/.test(kind);
}
