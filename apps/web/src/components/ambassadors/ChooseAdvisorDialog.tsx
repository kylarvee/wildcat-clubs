"use client";

import { useState } from "react";
import { Loader2, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/layout";
import { PersonPicker, type PickerPerson } from "@/components/roles/PersonPicker";
import { useRunAction } from "@/components/roles/useRunAction";
import { setAmbassadorAdvisorAction } from "./actions";

/** WSUSA picks the faculty or staff member who advises a college's ambassador program (admin → Club approvals → Ambassador programs). */
export function ChooseAdvisorDialog({
  orgId,
  orgName,
  collegeName,
  currentName,
  people,
}: {
  orgId: string;
  orgName: string;
  collegeName: string;
  currentName: string | null;
  /** Faculty and staff, the college's own first. */
  people: PickerPerson[];
}) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const { pending, error, setError, run } = useRunAction();
  const person = people.find((p) => p.id === userId);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setUserId(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={currentName ? "ghost" : "secondary"} aria-label={currentName ? `Change ${orgName}'s advisor` : `Choose ${orgName}'s advisor`}>
          <UserCog className="h-4 w-4" aria-hidden /> {currentName ? "Change" : "Choose advisor"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={currentName ? `Change ${orgName}'s advisor` : `Choose ${orgName}'s advisor`}
        description={`The advisor is ${collegeName}'s point person for its ambassadors. They get full access to the program and run its elections and leadership pipeline with its President.${currentName ? ` ${currentName}'s role ends when you confirm.` : ""}`}
      >
        <PersonPicker people={people} value={userId} onChange={setUserId} label="Choose a faculty or staff member" emptyText="No faculty or staff match." />
        {error ? (
          <Callout tone="danger" className="mt-4">
            {error}
          </Callout>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!userId || pending}
            onClick={async () => {
              if (!userId) return;
              const r = await run(() => setAmbassadorAdvisorAction({ orgId, userId }), { success: `${person?.name ?? "They"} now advise${person ? "s" : ""} ${orgName}.` });
              if (r.ok) {
                setOpen(false);
                setUserId(null);
              }
            }}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {person ? `Make ${person.name.split(" ")[0]} the advisor` : "Make advisor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
