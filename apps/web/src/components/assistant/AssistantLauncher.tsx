import { getCurrentUser } from "@/lib/auth/session";
import { aiLive } from "@/lib/config";
import { AssistantDock } from "@/components/assistant/AssistantDock";

/**
 * CONTRACT (owner: AI builder). Floating "Ask Wildcat Clubs" button + chat
 * panel, rendered by the root layout on every page. Renders nothing unless a
 * sysadmin turned the assistant on and an API key is present
 * (aiLive("assistant")), and the viewer is signed in. Everything else loads
 * when the panel is first opened.
 */
export async function AssistantLauncher() {
  const [user, live] = await Promise.all([getCurrentUser(), aiLive("assistant")]);
  if (!user || !live) return null;
  return <AssistantDock firstName={user.name.split(" ")[0] || user.name} />;
}
