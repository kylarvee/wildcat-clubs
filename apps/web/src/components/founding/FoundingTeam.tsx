import type { Club } from "@prisma/client";
import { Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import type { ClubAccess } from "@/lib/authz";
import { isFounder } from "@/lib/authz/founding";
import { foundingTeam } from "@/lib/clubs/founding";
import { COFOUNDER_PENDING_CAP } from "@/lib/founding/rules";
import { INSTITUTION } from "@/lib/institution";
import { fmtLongDate } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CofounderPanel } from "@/components/founding/CofounderPanel";

/**
 * "Your founding team": co-founders on a founding club's Overview (the
 * checklist and the in-review page). Optional, so it isn't a checklist step,
 * but it means a founder isn't founding alone: co-founders can hold seats on
 * the founding org chart before the club is approved.
 */
export async function FoundingTeam({ club, access }: { club: Club; access: ClubAccess }) {
  const [viewer, team] = await Promise.all([getCurrentUser(), foundingTeam(club.id)]);
  const canInvite = isFounder(access, club, viewer?.id);
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Users className="h-4 w-4 text-ink-3" aria-hidden /> Your founding team
          </span>
        }
        description="Invite fellow students to start the club with you. Once they accept, you can give them seats on the org chart, before the club is approved."
      />
      <CardBody>
        <CofounderPanel
          clubId={club.id}
          slug={club.slug}
          canInvite={canInvite}
          members={team.members}
          invites={team.pending.map((p) => ({ id: p.id, name: p.name, email: p.email, sentLabel: fmtLongDate(p.createdAt), hasAccount: p.hasAccount }))}
          cap={COFOUNDER_PENDING_CAP}
          studentDomain={INSTITUTION.studentEmailDomain}
        />
      </CardBody>
    </Card>
  );
}
