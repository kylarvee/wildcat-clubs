"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AnnouncementAudience } from "@prisma/client";
import { Eye, Loader2, PenLine, Send } from "lucide-react";
import type { ActionResult } from "@/lib/domain/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RichTextEditor } from "@/components/rich/RichTextEditor";
import { AnnouncementPreview } from "@/components/announcements/AnnouncementPreview";
import type { FrameAuthor, FrameClub } from "@/components/announcements/AnnouncementFrame";
import { ANNOUNCEMENT_TITLE_MAX, AUDIENCE_BADGE, audienceOptions, type AnnouncementScope } from "@/components/announcements/labels";

export type AnnouncementDraft = { title: string; bodyHtml: string; audience: AnnouncementAudience; pinned: boolean };

const OFFLINE = "We couldn't reach the server. Your announcement wasn't saved. Check your connection and try again.";

/** True when the editor holds no text, picture or embed. */
function isBlank(html: string) {
  return !html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() && !/data-embed=|<img\b/i.test(html);
}

function reachText(scope: AnnouncementScope, audience: AnnouncementAudience, n: number) {
  if (n === 0) return audience === "LEADERS" ? "No leaders to notify yet" : "No one to notify yet";
  const count = n.toLocaleString("en-US");
  if (audience === "LEADERS") return `Notifies ${count} ${n === 1 ? "leader" : "leaders"}`;
  if (scope === "club") return `Notifies ${count} ${n === 1 ? "member" : "members"}`;
  return `Notifies ${count} ${n === 1 ? "account" : "accounts"}`;
}

/**
 * Write or edit an announcement: title, rich body (events, files, videos and
 * documents can be embedded), audience and pin, with a live preview of what
 * readers will see. `save` is the route's server action.
 */
export function AnnouncementComposer({
  mode,
  scope,
  clubId,
  clubName,
  initial,
  reach,
  author,
  club,
  save,
  doneHref,
}: {
  mode: "create" | "edit";
  scope: AnnouncementScope;
  clubId: string | null;
  clubName?: string;
  initial?: AnnouncementDraft | null;
  /** How many people each audience would notify; shown when posting. */
  reach?: Record<AnnouncementAudience, number> | null;
  author: FrameAuthor;
  club?: FrameClub | null;
  save: (input: AnnouncementDraft) => Promise<ActionResult<{ id: string; notified: number }>>;
  doneHref: string;
}) {
  const router = useRouter();
  const start = useMemo<AnnouncementDraft>(() => initial ?? { title: "", bodyHtml: "", audience: "MEMBERS", pinned: false }, [initial]);
  const [title, setTitle] = useState(start.title);
  const [html, setHtml] = useState(start.bodyHtml);
  const [audience, setAudience] = useState<AnnouncementAudience>(start.audience);
  const [pinned, setPinned] = useState(start.pinned);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const audienceName = useId();

  const options = audienceOptions(scope, clubName);
  const dirty = title !== start.title || html !== start.bodyHtml || audience !== start.audience || pinned !== start.pinned;
  const widened = mode === "edit" && audience !== start.audience;

  // Leaving with unsaved work asks first (closing the tab or reloading).
  useEffect(() => {
    if (!dirty || done) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, done]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let bad = false;
    if (!title.trim()) {
      setTitleError("Give the announcement a title.");
      bad = true;
    }
    if (isBlank(html)) {
      setBodyError("Write the announcement first.");
      bad = true;
    }
    if (bad) {
      setTab("write");
      return;
    }
    setPending(true);
    try {
      const r = await save({ title: title.trim(), bodyHtml: html, audience, pinned });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone(true);
      const n = r.data.notified;
      const who = n === 1 ? "person" : "people";
      toast.success(
        mode === "create"
          ? n
            ? `Posted. ${n.toLocaleString("en-US")} ${who} will be notified.`
            : "Posted."
          : n
            ? `Saved. ${n.toLocaleString("en-US")} more ${who} will be notified.`
            : "Saved.",
      );
      router.push(doneHref);
    } catch {
      setError(OFFLINE);
    } finally {
      setPending(false);
    }
  }

  function cancel() {
    if (dirty) setConfirmLeave(true);
    else router.push(doneHref);
  }

  const previewBadge = scope === "club" ? (audience === "PUBLIC" ? null : AUDIENCE_BADGE.club[audience]) : audience === "LEADERS" ? AUDIENCE_BADGE.university.LEADERS : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Field label="Title" required error={titleError}>
        {(id) => (
          <Input
            id={id}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleError(null);
            }}
            maxLength={ANNOUNCEMENT_TITLE_MAX}
            placeholder={scope === "club" ? "e.g. Room change for Thursday's meeting" : "e.g. Spring club funding requests are open"}
            aria-invalid={titleError ? true : undefined}
            autoFocus={mode === "create"}
          />
        )}
      </Field>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "write" | "preview")}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="text-sm font-medium text-ink">
            Announcement <span className="text-danger">*</span>
          </p>
          <TabsList className="border-b-0" aria-label="Write or preview">
            <TabsTrigger value="write" className="flex items-center gap-1.5">
              <PenLine className="h-4 w-4" aria-hidden="true" /> Write
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex items-center gap-1.5">
              <Eye className="h-4 w-4" aria-hidden="true" /> Preview
            </TabsTrigger>
          </TabsList>
        </div>
        {/* Both panels stay mounted so the editor keeps its place (and undo history) while you preview. */}
        <TabsContent value="write" forceMount className="mt-2 data-[state=inactive]:hidden">
          <RichTextEditor
            defaultValue={start.bodyHtml}
            onChange={(v) => {
              setHtml(v);
              setBodyError(null);
            }}
            clubId={clubId}
            variant="full"
            fileScope={scope === "university" ? "university" : "club"}
            minHeight={220}
            ariaLabel="Announcement"
            placeholder="Write your announcement. Use Insert to add an event, a file, a video or a document."
          />
          {bodyError ? <p className="mt-1.5 text-xs text-danger">{bodyError}</p> : null}
        </TabsContent>
        <TabsContent value="preview" forceMount className="mt-2 data-[state=inactive]:hidden">
          <p className="mb-2 text-xs text-ink-3">This is how it looks to {scope === "club" ? (audience === "LEADERS" ? "your leaders" : "members") : "readers"}.</p>
          <AnnouncementPreview title={title} html={html} author={author} badge={previewBadge} pinned={pinned} club={club ?? null} university={scope === "university"} />
        </TabsContent>
      </Tabs>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Who it&apos;s for</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {options.map((o) => {
            const on = audience === o.value;
            return (
              <label
                key={o.value}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-brand-100",
                  on ? "border-brand bg-brand-50/60" : "border-line-2 bg-surface hover:bg-muted/60",
                )}
              >
                <input type="radio" name={audienceName} value={o.value} checked={on} onChange={() => setAudience(o.value)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]" />
                <span className="min-w-0 text-sm">
                  <span className="block font-medium text-ink">{o.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{o.description}</span>
                  {mode === "create" && reach ? <span className="mt-1.5 block text-xs font-medium text-ink-2">{reachText(scope, o.value, reach[o.value])}</span> : null}
                </span>
              </label>
            );
          })}
        </div>
        {mode === "edit" ? (
          <p className="text-xs text-ink-3">
            {widened
              ? "You changed the audience. Saving notifies only the people it newly reaches."
              : "Saving your changes doesn't notify anyone again."}
          </p>
        ) : null}
      </fieldset>

      <Checkbox
        checked={pinned}
        onChange={(e) => setPinned(e.target.checked)}
        label="Pin to the top"
        description={scope === "club" ? "Pinned announcements stay first on the club page until you unpin them." : "Pinned announcements stay first on everyone's dashboard until you unpin them."}
      />

      {error ? (
        <Callout tone="danger" title={mode === "create" ? "Not posted" : "Not saved"}>
          {error}
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <Button variant="outline" onClick={cancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : mode === "create" ? <Send className="h-4 w-4" aria-hidden="true" /> : null}
          {pending ? (mode === "create" ? "Posting…" : "Saving…") : mode === "create" ? "Post announcement" : "Save changes"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={mode === "create" ? "Discard this announcement?" : "Discard your changes?"}
        description={mode === "create" ? "What you've written won't be saved." : "Your edits won't be saved. The announcement stays as it was."}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger
        onConfirm={() => {
          setDone(true);
          router.push(doneHref);
        }}
      />
    </form>
  );
}
