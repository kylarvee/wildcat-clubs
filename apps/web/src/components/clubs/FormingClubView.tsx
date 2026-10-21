import Link from "next/link";
import { Eye, Sprout } from "lucide-react";
import { foundersLine } from "@/lib/founding/rules";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Callout, Container } from "@/components/ui/layout";
import { FollowFormingButton } from "@/components/clubs/FollowFormingButton";

/**
 * A forming club's page for signed-in viewers outside its founding team
 * (lib/authz/founding canSeeFormingClub): its name, short description,
 * founders' names and Follow, and nothing else until it's approved. Founders
 * see it as a preview from Settings.
 */
export function FormingClubView({
  club,
  founders,
  office,
  following,
  preview,
}: {
  club: { id: string; slug: string; name: string; shortDescription: string; logoUrl: string | null; logoColor: string };
  founders: string[];
  office: string;
  following: boolean;
  preview: boolean;
}) {
  return (
    <Container size="md">
      {preview ? (
        <Callout tone="info" icon={<Eye />} title="Preview" className="mb-6">
          This is what signed-in students see while {club.name} is listed as forming.{" "}
          <Link href={`/clubs/${club.slug}/manage/settings`} className="font-medium underline underline-offset-2">
            Back to Settings
          </Link>
          .
        </Callout>
      ) : null}
      <Card>
        <CardBody className="space-y-5 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="lg" />
            <div className="min-w-0">
              <Badge tone="info">
                <Sprout className="h-3 w-3" aria-hidden /> Forming
              </Badge>
              <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-ink sm:text-3xl">{club.name}</h1>
              <p className="mt-1 text-sm text-ink-3">Forming: not yet recognized by {office}</p>
            </div>
          </div>
          <p className="text-ink-2">{club.shortDescription || "The founders are still writing their description."}</p>
          {founders.length ? (
            <dl className="text-sm">
              <dt className="font-medium text-ink">{founders.length === 1 ? "Founder" : "Founders"}</dt>
              <dd className="text-ink-2">{foundersLine(founders, founders.length)}</dd>
            </dl>
          ) : null}
          <div className="flex flex-col gap-2 border-t border-line pt-5 sm:flex-row sm:items-center">
            {preview ? null : <FollowFormingButton clubId={club.id} clubName={club.name} following={following} />}
            <p className="text-sm text-ink-3">Follow it to hear when it&apos;s approved. Its events, members and documents show here once {office} approves it.</p>
          </div>
        </CardBody>
      </Card>
      <p className="mt-4 text-sm">
        <Link href="/clubs#forming" className="font-medium text-brand-600 hover:underline">
          See other clubs that are forming
        </Link>
      </p>
    </Container>
  );
}
