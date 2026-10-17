import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";

/** A dashboard card: icon + heading, an optional "see all" link, then the body. */
export function Panel({
  id,
  title,
  icon,
  description,
  link,
  children,
  className,
  bodyClassName,
}: {
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  link?: { href: string; label: string };
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={className}>
      <Card>
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="flex items-center gap-2 text-base font-semibold text-ink [&>svg]:h-4.5 [&>svg]:w-4.5 [&>svg]:shrink-0 [&>svg]:text-brand">
              {icon}
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-sm text-ink-3">{description}</p> : null}
          </div>
          {link ? (
            <Link href={link.href} className="inline-flex shrink-0 items-center gap-1 rounded-md text-sm font-medium text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand">
              {link.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
        <div className={cn("px-4 py-4 sm:px-5", bodyClassName)}>{children}</div>
      </Card>
    </section>
  );
}
