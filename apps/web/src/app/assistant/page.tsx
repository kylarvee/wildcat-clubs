import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { isSysadmin } from "@/lib/authz";
import { aiLive, getConfig } from "@/lib/config";
import { listConversations, loadThread } from "@/lib/ai/conversations";
import { starterPrompts } from "@/lib/ai/starters";
import { buildView } from "@/lib/ai/view";
import { ButtonLink } from "@/components/ui/button";
import { Callout, Container, EmptyState, PageHeader } from "@/components/ui/layout";
import { AssistantWorkspace } from "@/components/assistant/AssistantWorkspace";

export const metadata: Metadata = { title: "Ask Wildcat Clubs" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Ask Wildcat Clubs — the full-page assistant with your conversation history.
 * When a sysadmin hasn't turned it on, this explains that (and, for
 * sysadmins, what's missing) instead.
 */
export default async function AssistantPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser("/assistant");
  const live = await aiLive("assistant");

  if (!live) {
    const sysadmin = isSysadmin(user);
    const switchOn = sysadmin ? (await getConfig())["ai.assistantEnabled"] : false;
    const keyPresent = sysadmin ? Boolean(process.env.ANTHROPIC_API_KEY) : false;
    return (
      <Container size="md">
        <PageHeader title="Ask Wildcat Clubs" description="The built-in assistant for finding, founding and running clubs at Weber State." />
        <EmptyState
          icon={<Sparkles />}
          title="The assistant isn't turned on yet"
          description={
            sysadmin
              ? "Ask Wildcat Clubs runs on Claude Haiku and Claude Sonnet. It needs the switch in System settings and an Anthropic API key on the server."
              : "A system administrator can switch it on. Until then, everything it would help with is right here in Wildcat Clubs."
          }
          action={
            sysadmin ? (
              <ButtonLink href="/system/integrations">Open integrations</ButtonLink>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href="/dashboard">Go to your dashboard</ButtonLink>
                <ButtonLink href="/clubs" variant="outline">
                  Browse clubs
                </ButtonLink>
              </div>
            )
          }
        />
        {sysadmin ? (
          <Callout tone="info" title="What's missing" className="mt-4">
            <ul className="list-disc space-y-1 pl-5">
              <li>{switchOn ? "The assistant switch is on." : "The assistant switch is off (System settings → Integrations)."}</li>
              <li>{keyPresent ? "An API key is set." : "ANTHROPIC_API_KEY isn't set on the server."}</li>
            </ul>
          </Callout>
        ) : null}
      </Container>
    );
  }

  const sp = await searchParams;
  const requested = Array.isArray(sp.c) ? sp.c[0] : sp.c;
  const [conversations, starters, initialView] = await Promise.all([
    listConversations(user),
    starterPrompts(user),
    requested ? loadThread(user, requested).then(buildView, () => null) : Promise.resolve(null),
  ]);

  return (
    <Container size="xl">
      <PageHeader
        title="Ask Wildcat Clubs"
        description="Ask how anything works, look things up, or have it take a step for you. It can make mistakes, and it only acts after you confirm."
      />
      {requested && !initialView ? (
        <Callout tone="warning" className="mb-4">
          That conversation wasn't found — it may have been deleted. You can start a new one below.
        </Callout>
      ) : null}
      <AssistantWorkspace firstName={user.name.split(" ")[0] || user.name} initialView={initialView} initialConversations={conversations} starters={starters} />
    </Container>
  );
}
