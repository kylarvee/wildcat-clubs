"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/form";
import { toast } from "@/components/ui/misc";
import { setClubOfficeAction } from "@/app/admin/clubs/actions";

/**
 * WSUSA moves a club to another office (lib/domain/offices setClubOffice).
 * Its open admin tasks go with it, and its leaders are told who oversees it.
 */
export function ClubOfficeForm({
  clubId,
  clubName,
  current,
  offices,
  openTasks,
}: {
  clubId: string;
  clubName: string;
  /** The office overseeing the club now (the umbrella's id for WSUSA). */
  current: string;
  offices: { id: string; name: string }[];
  /** Open admin tasks about the club, which move with it. */
  openTasks: number;
}) {
  const router = useRouter();
  const [officeId, setOfficeId] = useState(current);
  const [pending, start] = useTransition();
  const next = offices.find((o) => o.id === officeId);
  const move = () =>
    start(async () => {
      const r = await setClubOfficeAction({ clubId, officeId });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${clubName} is now overseen by ${r.data.office}`);
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <Field label="Office" hint="Moving a club sends its approvals, renewal and other open work to that office.">
        {(id) => (
          <Select id={id} value={officeId} onChange={(e) => setOfficeId(e.target.value)} disabled={pending}>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="outline" disabled={pending || officeId === current}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Building2 className="h-4 w-4" aria-hidden />} Move club
          </Button>
        }
        title={`Move ${clubName} to ${next?.name ?? "this office"}?`}
        description={`${next?.name ?? "The office"} will oversee the club from now on.${openTasks ? ` ${openTasks === 1 ? "Its open admin task moves" : `Its ${openTasks} open admin tasks move`} there too, except reports, review moderation and anything else only WSUSA handles.` : ""} The club's President, Vice Presidents and advisors are told.`}
        confirmLabel="Move club"
        onConfirm={move}
      />
    </div>
  );
}
