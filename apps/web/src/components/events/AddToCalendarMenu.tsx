"use client";

import { CalendarPlus, ChevronDown, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";

/**
 * "Add to calendar" for one date of an event: a prefilled Google Calendar
 * event (lib/events/share eventGoogleCalendarUrl), or the date's .ics file
 * (GET /api/ics/occurrence/<id>) for Apple Calendar and Outlook. For every
 * date as it changes, people follow the club or subscribe to a feed instead.
 */
export function AddToCalendarMenu({ googleUrl, icsUrl }: { googleUrl: string; icsUrl: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Add to calendar <ChevronDown className="h-4 w-4 text-ink-3" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem asChild>
          <a href={googleUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 text-ink-3" aria-hidden="true" /> Google Calendar
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={icsUrl} download>
            <Download className="h-4 w-4 text-ink-3" aria-hidden="true" /> Apple / Outlook (.ics)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
