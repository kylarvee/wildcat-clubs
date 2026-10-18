"use client";

import { useState } from "react";
import { Loader2, Phone, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/layout";
import { RELATIONSHIP_LABEL } from "@/lib/details/rules";
import type { ActionResult } from "@/lib/domain/kit";
import type { EmergencyContact } from "@/lib/domain/details";

/**
 * Opening someone's emergency contact is deliberate: a short warning first,
 * then the contact. lib/domain/details records each opening. `reveal` is the
 * server action that opens it (the club roster's, or the admin People page's).
 */
export function EmergencyContactDialog({
  member,
  onClose,
  reveal,
}: {
  member: { userId: string; name: string } | null;
  onClose: () => void;
  reveal: (userId: string) => Promise<ActionResult<EmergencyContact>>;
}) {
  const [contact, setContact] = useState<EmergencyContact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function open() {
    if (!member) return;
    setPending(true);
    setError(null);
    const r = await reveal(member.userId).catch(() => null);
    setPending(false);
    if (!r) return setError("We couldn't reach the server. Try again.");
    if (!r.ok) return setError(r.error);
    setContact(r.data);
  }

  return (
    <Dialog
      open={Boolean(member)}
      onOpenChange={(o) => {
        if (!o) {
          setContact(null);
          setError(null);
          onClose();
        }
      }}
    >
      {member ? (
        <DialogContent title={`${member.name}'s emergency contact`} description={contact ? undefined : "Open it only when you need to reach someone for them. WSUSA can see that you opened it."}>
          {contact ? (
            <div className="space-y-2 rounded-xl border border-line bg-muted/50 p-4 text-sm">
              <p className="text-base font-semibold text-ink">{contact.name}</p>
              {contact.relationship ? <p className="text-ink-2">{RELATIONSHIP_LABEL[contact.relationship]}</p> : null}
              {contact.phone ? (
                <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 font-medium text-brand-600 hover:underline">
                  <Phone className="h-4 w-4" aria-hidden /> {contact.phone}
                </a>
              ) : null}
              {contact.email ? (
                <p>
                  <a href={`mailto:${contact.email}`} className="text-brand-600 hover:underline">
                    {contact.email}
                  </a>
                </p>
              ) : null}
            </div>
          ) : (
            <Callout tone="warning" icon={<ShieldAlert />}>
              Emergency contacts are private. Each time a leader opens one, it&apos;s recorded with their name.
            </Callout>
          )}
          {error ? <Callout tone="danger" className="mt-3">{error}</Callout> : null}
          <DialogFooter>
            {contact ? (
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={open} disabled={pending}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Open emergency contact
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
