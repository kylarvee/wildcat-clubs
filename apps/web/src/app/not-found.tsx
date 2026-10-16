import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">We couldn&apos;t find that page</h1>
      <p className="mt-3 text-ink-2">It may have moved, or you may not have access to it.</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/clubs" className={buttonClasses("primary")}>
          Browse clubs
        </Link>
        <Link href="/dashboard" className={buttonClasses("outline")}>
          Dashboard
        </Link>
      </div>
    </div>
  );
}
