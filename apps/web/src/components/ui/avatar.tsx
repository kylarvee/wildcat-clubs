import { cn } from "@/components/ui/cn";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

const sizes = { xs: "h-6 w-6 text-[10px]", sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-14 w-14 text-lg", xl: "h-24 w-24 text-3xl" };

export function Avatar({
  name,
  src,
  color = "#492365",
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  color?: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ring-2 ring-white", sizes[size], className)}
      style={{ backgroundColor: color }}
      aria-hidden={!name}
      title={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function AvatarStack({ people, max = 5, size = "sm" }: { people: { name: string; avatarUrl?: string | null; avatarColor?: string }[]; max?: number; size?: keyof typeof sizes }) {
  const shown = people.slice(0, max);
  return (
    <div className="flex -space-x-2">
      {shown.map((p, i) => (
        <Avatar key={i} name={p.name} src={p.avatarUrl} color={p.avatarColor} size={size} />
      ))}
      {people.length > max ? (
        <span className={cn("inline-flex items-center justify-center rounded-full bg-muted font-medium text-ink-2 ring-2 ring-white", sizes[size])}>+{people.length - max}</span>
      ) : null}
    </div>
  );
}

/** A club's logo, or a monogram tile in the club's color. */
export function ClubLogo({
  name,
  src,
  color = "#492365",
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  color?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const s = { sm: "h-8 w-8 text-xs rounded-lg", md: "h-12 w-12 text-base rounded-xl", lg: "h-16 w-16 text-xl rounded-2xl", xl: "h-24 w-24 text-3xl rounded-3xl" }[size];
  const mono = name
    .replace(/[^A-Za-z0-9 &]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["of", "the", "and", "&", "for", "at", "club", "society", "association"].includes(w.toLowerCase()))
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden font-bold tracking-tight text-white shadow-sm", s, className)} style={{ backgroundColor: color }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`${name} logo`} className="h-full w-full object-cover" />
      ) : (
        mono || name[0]
      )}
    </span>
  );
}
