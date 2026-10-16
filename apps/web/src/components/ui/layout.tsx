import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** Page title block. Every page starts with one. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: { href?: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("mb-6", className)}>
      {breadcrumbs?.length ? (
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-sm text-ink-3" aria-label="Breadcrumb">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="h-3.5 w-3.5" /> : null}
              {b.href ? (
                <Link href={b.href} className="hover:text-ink">
                  {b.label}
                </Link>
              ) : (
                <span className="text-ink-2">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
          {description ? <p className="mt-1.5 max-w-3xl text-ink-2">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Standard page width container. */
export function Container({ className, children, size = "lg" }: { className?: string; children: ReactNode; size?: "md" | "lg" | "xl" }) {
  const max = { md: "max-w-4xl", lg: "max-w-6xl", xl: "max-w-7xl" }[size];
  return <div className={cn("mx-auto w-full px-4 py-8 sm:px-6", max, className)}>{children}</div>;
}

export function Section({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {description ? <p className="text-sm text-ink-3">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-3 text-ink-3 [&>svg]:h-8 [&>svg]:w-8">{icon}</div> : null}
      <p className="font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-ink-3">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

const calloutTones = {
  info: "border-blue-200 bg-info-50 text-blue-900",
  warning: "border-amber-200 bg-warning-50 text-amber-900",
  danger: "border-red-200 bg-danger-50 text-red-900",
  success: "border-green-200 bg-success-50 text-green-900",
  brand: "border-brand-100 bg-brand-50 text-brand-700",
};

export function Callout({ tone = "info", title, children, icon, className }: { tone?: keyof typeof calloutTones; title?: ReactNode; children?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm", calloutTones[tone], className)} role={tone === "danger" || tone === "warning" ? "alert" : undefined}>
      {icon ? <div className="mt-0.5 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</div> : null}
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="leading-relaxed">{children}</div> : null}
      </div>
    </div>
  );
}

/** A labeled number. */
export function Stat({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-card)]", className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function KeyValue({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map((it, i) => (
        <div key={i}>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">{it.label}</dt>
          <dd className="mt-0.5 text-sm text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted", className)} />;
}

export function ProgressBar({ value, max = 100, className, tone = "brand" }: { value: number; max?: number; className?: string; tone?: "brand" | "success" | "warning" | "danger" }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const bar = { brand: "bg-brand", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}
