import { fmtLongDate, fmtTime } from "@/lib/time";

/** "Oct 20, 2026 at 3:12 PM": when a document was issued. */
export const issued = (d: Date) => `${fmtLongDate(d)} at ${fmtTime(d)}`;

/** The platform's support address, as a mail link. */
export function SupportLink({ email }: { email: string }) {
  return (
    <a href={`mailto:${email}`} className="font-medium text-brand-600 hover:underline">
      {email}
    </a>
  );
}
