import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { DomainError } from "@/lib/domain/kit";
import { openClubChat } from "@/lib/domain/messaging";
import { ClubLogo } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";

/**
 * /messages/club/<slug> — "Club chat" links land here and go straight to the
 * club's group chat (created on first use). People outside the club get a
 * friendly explanation instead.
 */
export default async function ClubChatRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const club = await db.club.findUnique({ where: { slug }, select: { id: true, name: true, slug: true, status: true, logoUrl: true, logoColor: true } });
  if (!club || (club.status !== "APPROVED" && club.status !== "RETIRED")) notFound();

  let conversationId: string | null = null;
  let refusal: string | null = null;
  try {
    conversationId = (await openClubChat(user, club.id)).id;
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    if (e.code === "NOT_FOUND") notFound();
    refusal = club.status === "RETIRED" ? `${club.name} is retired. Its chat stays readable for the people who were in the club.` : e.message;
  }
  if (conversationId) redirect(`/messages/${conversationId}`);

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-line px-2 py-2.5 md:hidden">
        <Link href="/messages" className="inline-flex items-center gap-1.5 rounded-lg p-2 text-sm font-medium text-ink-2 hover:bg-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All conversations
        </Link>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <div className="relative">
          <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="lg" />
          <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-muted text-ink-2">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-ink">{club.name}&apos;s chat is for its members</h2>
        <p className="mt-1 max-w-md text-sm text-ink-3">{refusal}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {club.status === "APPROVED" ? <ButtonLink href={`/clubs/${club.slug}`}>Visit {club.name}</ButtonLink> : null}
          <Link href="/messages" className="inline-flex h-10 items-center px-3 text-sm font-medium text-brand-600 hover:underline">
            Back to Messages
          </Link>
        </div>
      </div>
    </div>
  );
}
