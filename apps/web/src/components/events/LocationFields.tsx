"use client";

import { useEffect, useId, useState } from "react";
import type { LocationType } from "@prisma/client";
import { Building2, CircleHelp, Globe, MapPin } from "lucide-react";
import { Checkbox, Input, Label, Select } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { MapEmbed } from "@/components/embeds/MapEmbed";
import { campusMapQuery } from "@/lib/events/share";

export type BuildingOption = { id: string; name: string; code: string };

export type LocationValue = {
  locationType: LocationType;
  buildingId: string;
  room: string;
  address: string;
  virtualUrl: string;
  createMeetLink: boolean;
};

export const EMPTY_LOCATION: LocationValue = { locationType: "TBD", buildingId: "", room: "", address: "", virtualUrl: "", createMeetLink: false };

const TABS: { type: LocationType; label: string; icon: typeof MapPin }[] = [
  { type: "CAMPUS", label: "On campus", icon: Building2 },
  { type: "ADDRESS", label: "Off campus", icon: MapPin },
  { type: "VIRTUAL", label: "Online", icon: Globe },
  { type: "TBD", label: "Not decided", icon: CircleHelp },
];

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Where an event happens. Campus buildings pin the building on a map;
 * off-campus addresses pin through Google Maps; online events take a link or a
 * Google Meet request (created only while Google Calendar sync is on). An
 * in-person event may add an online link too, which makes it hybrid (the
 * full editor only; quick create keeps to the basics).
 */
export function LocationFields({
  value,
  onChange,
  buildings,
  googleLive,
  compact,
}: {
  value: LocationValue;
  onChange: (v: LocationValue) => void;
  buildings: BuildingOption[];
  googleLive: boolean;
  compact?: boolean;
}) {
  const id = useId();
  const set = (patch: Partial<LocationValue>) => onChange({ ...value, ...patch });
  const building = buildings.find((b) => b.id === value.buildingId) ?? null;
  const address = useDebounced(value.address.trim(), 700);

  // Hybrid: people can watch or join remotely. Check-in still happens in the room (lib/attendance/rules).
  const onlineLink = compact ? null : (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-ol`}>
        Online link <span className="font-normal text-ink-3">(optional)</span>
      </Label>
      <Input
        id={`${id}-ol`}
        type="url"
        inputMode="url"
        value={value.virtualUrl}
        placeholder="https://meet.google.com/… or a Zoom / Teams link"
        aria-describedby={`${id}-olh`}
        onChange={(e) => set({ virtualUrl: e.target.value })}
      />
      <p id={`${id}-olh`} className="text-xs text-ink-3">
        Lets people watch or join remotely, which makes it a hybrid event. Check-in still happens in the room.
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Location type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TABS.map((t) => {
          const on = value.locationType === t.type;
          return (
            <button
              key={t.type}
              type="button"
              aria-pressed={on}
              onClick={() => set({ locationType: t.type })}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                on ? "border-brand bg-brand-50 text-brand" : "border-line-2 bg-surface text-ink-2 hover:bg-muted",
              )}
            >
              <t.icon className="h-4 w-4" aria-hidden /> {t.label}
            </button>
          );
        })}
      </div>

      {value.locationType === "CAMPUS" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-b`}>
                Building <span className="text-danger">*</span>
              </Label>
              <Select id={`${id}-b`} value={value.buildingId} onChange={(e) => set({ buildingId: e.target.value })} required>
                <option value="">Choose a building…</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-r`}>Room</Label>
              <Input id={`${id}-r`} value={value.room} maxLength={60} placeholder="e.g. 404" onChange={(e) => set({ room: e.target.value })} />
            </div>
          </div>
          {buildings.length === 0 ? <p className="text-sm text-ink-3">The campus building list is empty. An administrator adds buildings under Admin → Directory.</p> : null}
          {building && !compact ? <MapEmbed query={campusMapQuery(building.name)} height={220} /> : null}
          {onlineLink}
        </div>
      ) : null}

      {value.locationType === "ADDRESS" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-a`}>
              Address <span className="text-danger">*</span>
            </Label>
            <Input id={`${id}-a`} value={value.address} maxLength={300} placeholder="Street, city — or a place name" autoComplete="street-address" onChange={(e) => set({ address: e.target.value })} />
          </div>
          {address.length > 4 && !compact ? <MapEmbed query={address} height={220} /> : null}
          {onlineLink}
        </div>
      ) : null}

      {value.locationType === "VIRTUAL" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-v`}>Meeting link</Label>
            <Input
              id={`${id}-v`}
              type="url"
              inputMode="url"
              value={value.virtualUrl}
              placeholder="https://meet.google.com/… or a Zoom / Teams link"
              onChange={(e) => set({ virtualUrl: e.target.value })}
            />
          </div>
          {!value.virtualUrl.trim() ? (
            <Checkbox
              label="Create a Google Meet link for me"
              description={googleLive ? "We'll add it when you save." : undefined}
              checked={value.createMeetLink}
              onChange={(e) => set({ createMeetLink: e.target.checked })}
            />
          ) : null}
          {!value.virtualUrl.trim() && value.createMeetLink && !googleLive ? (
            <Callout tone="info">
              Google Calendar sync is off right now, so the Meet link will be created once a system administrator turns it on and you save the event again. Paste a link above if you
              have one sooner.
            </Callout>
          ) : null}
        </div>
      ) : null}

      {value.locationType === "TBD" ? <p className="text-sm text-ink-3">The event shows “Location to be decided” until you pick a place.</p> : null}
    </div>
  );
}
