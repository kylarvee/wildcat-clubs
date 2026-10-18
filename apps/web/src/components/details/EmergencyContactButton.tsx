"use client";

import { useState } from "react";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/domain/kit";
import type { EmergencyContact } from "@/lib/domain/details";
import { EmergencyContactDialog } from "@/components/details/EmergencyContactDialog";

/** A button that opens someone's emergency contact through the logged dialog. */
export function EmergencyContactButton({ userId, name, reveal }: { userId: string; name: string; reveal: (userId: string) => Promise<ActionResult<EmergencyContact>> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <LifeBuoy className="h-4 w-4" aria-hidden /> Emergency contact
      </Button>
      <EmergencyContactDialog member={open ? { userId, name } : null} onClose={() => setOpen(false)} reveal={reveal} />
    </>
  );
}
