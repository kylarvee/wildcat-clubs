import { ExternalLink, MapPin } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { mapsEmbedUrl, mapsSearchUrl } from "@/lib/rich/embeds";

/**
 * CONTRACT (owner: rich-text builder). Google Maps pin. For campus buildings
 * pass `query` = "<Building name>, <INSTITUTION.mapsSuffix>" (or lat/lng);
 * for off-campus pass the address. No API key needed (maps embed URL).
 * `label` is the name shown under the map (defaults to the query).
 * Works in server and client components.
 */
export function MapEmbed({
  query,
  lat,
  lng,
  height = 240,
  className,
  label,
}: {
  query?: string | null;
  lat?: number | null;
  lng?: number | null;
  height?: number;
  className?: string;
  label?: string | null;
}) {
  const coords = lat != null && lng != null ? `${lat},${lng}` : null;
  const text = query?.trim() || null;
  const pin = coords ?? text;
  if (!pin) return null;
  const name = label?.trim() || text || "Map";
  return (
    <figure className={cn("overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]", className)}>
      <iframe
        title={`Map of ${name}`}
        className="block w-full border-0 bg-muted"
        style={{ height }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        src={mapsEmbedUrl(pin)}
      />
      <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-sm">
        <span className="flex min-w-0 flex-[1_1_9rem] items-center gap-1.5 text-ink">
          <MapPin className="h-4 w-4 shrink-0 text-brand" aria-hidden />
          <span className="truncate font-medium">{name}</span>
        </span>
        {/* Search by name when we have one: Google shows the place card, not just a dropped pin. */}
        <a
          href={mapsSearchUrl(text ?? pin)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Open in Google Maps
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </figcaption>
    </figure>
  );
}
