"use client";

import { useId, useState } from "react";
import { CircleCheck, CircleDashed, Loader2, TriangleAlert } from "lucide-react";
import type { ConfigKey } from "@/lib/config";
import { Badge } from "@/components/ui/badge";
import { Switch, toast } from "@/components/ui/misc";
import { saveConfigAction } from "@/app/system/actions";

/** An environment variable the integration needs. Optional ones have a working fallback. */
export type Credential = { name: string; present: boolean; optional?: boolean; note?: string };

export function CredentialList({ items }: { items: Credential[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Credentials">
      {items.map((c) => (
        <li key={c.name} className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-ink-2">
          {c.present ? <CircleCheck className="h-3.5 w-3.5 text-success" aria-hidden /> : <CircleDashed className="h-3.5 w-3.5 text-ink-3" aria-hidden />}
          <code className="break-all font-mono">{c.name}</code>
          <span className={c.present ? "text-success" : "text-ink-3"}>{c.present ? "set" : "not set"}</span>
          {c.note ? <span className="text-ink-3">· {c.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * One on/off switch for a Claude feature or a Google/mobile integration.
 * "Live" needs both the switch and its credentials; otherwise the platform
 * keeps working on its own (mock mode) and says what's missing.
 */
export function IntegrationSwitch({
  configKey,
  title,
  help,
  checked: initial,
  credentials,
  offText,
  missingText,
}: {
  configKey: ConfigKey;
  title: string;
  help: string;
  checked: boolean;
  credentials: Credential[];
  /** What happens while the switch is off. */
  offText: string;
  /** What happens while it's on but credentials are missing. */
  missingText: string;
}) {
  const [checked, setChecked] = useState(initial);
  const [pending, setPending] = useState(false);
  const id = useId();
  const ready = credentials.every((c) => c.present || c.optional);

  async function toggle(next: boolean) {
    setChecked(next);
    setPending(true);
    try {
      const r = await saveConfigAction({ [configKey]: next });
      if (!r.ok) {
        setChecked(!next);
        toast.error(r.error);
        return;
      }
      toast.success(`${title} switched ${next ? "on" : "off"}`);
    } catch {
      setChecked(!next);
      toast.error("We couldn't reach the server, so nothing changed. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  const status = !checked ? (
    <Badge tone="neutral">
      <CircleDashed className="h-3 w-3" aria-hidden /> Off
    </Badge>
  ) : ready ? (
    <Badge tone="success">
      <CircleCheck className="h-3 w-3" aria-hidden /> Live
    </Badge>
  ) : (
    <Badge tone="warning">
      <TriangleAlert className="h-3 w-3" aria-hidden /> On, not live
    </Badge>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-5 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={id} className="font-medium text-ink">
            {title}
          </label>
          {status}
        </div>
        <p id={`${id}-help`} className="mt-0.5 text-sm text-ink-3">
          {help}
        </p>
        <p className="mt-1.5 text-sm text-ink-2" aria-live="polite">
          {!checked ? offText : ready ? "Working now." : missingText}
        </p>
        {credentials.length ? (
          <div className="mt-2">
            <CredentialList items={credentials} />
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-label="Saving" /> : null}
        <Switch id={id} checked={checked} onCheckedChange={(v) => void toggle(v)} disabled={pending} aria-describedby={`${id}-help`} />
      </div>
    </div>
  );
}
