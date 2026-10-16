/**
 * CONTRACT (owner: rich-text builder). Google Maps pin. For campus buildings
 * pass `query` = "<Building name>, <INSTITUTION.mapsSuffix>" (or lat/lng);
 * for off-campus pass the address. No API key needed (maps embed URL).
 * STUB.
 */
export function MapEmbed({ query, lat, lng, height = 240, className }: { query?: string; lat?: number | null; lng?: number | null; height?: number; className?: string }) {
  const q = lat != null && lng != null ? `${lat},${lng}` : (query ?? "");
  return (
    <iframe
      title={`Map: ${query ?? q}`}
      className={"w-full rounded-xl border border-line " + (className ?? "")}
      style={{ height }}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      src={`https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`}
    />
  );
}
