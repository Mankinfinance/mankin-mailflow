"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Copy, Plus, Webhook } from "lucide-react";
import {
  WEBHOOK_EVENT_BLURBS,
  WEBHOOK_EVENT_LABELS,
  type WebhookEvent,
} from "@/lib/webhooks/types";
import {
  createEndpointAction,
  deleteEndpointAction,
  sendTestAction,
  setEndpointEnabledAction,
} from "@/app/(mailflow)/marketing/webhooks/actions";
import { Card, Eyebrow } from "@/components/mailflow/MailflowPage";

/**
 * Endpoints, and what happened to what we sent them.
 *
 * The delivery log is half the screen because it is the half anyone
 * opens this page for. "Did the CRM hear that this client
 * unsubscribed" is a question that gets asked when somebody complains
 * about still being mailed, and answering it from a list of attempts
 * with their HTTP statuses beats answering it from a green tick.
 */

export interface EndpointView {
  id: string;
  name: string;
  url: string;
  description: string;
  events: string[];
  enabled: boolean;
  consecutiveFailures: number;
  lastDeliveredAt: Date | null;
  lastFailedAt: Date | null;
  deliveries: Array<{
    id: string;
    event: string;
    status: string;
    attempts: number;
    lastStatus: number | null;
    lastError: string | null;
    createdAt: Date;
  }>;
}

const ALL_EVENTS = Object.keys(WEBHOOK_EVENT_LABELS) as WebhookEvent[];

export function WebhookManager({ endpoints }: { endpoints: EndpointView[] }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(endpoints.length === 0);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [events, setEvents] = React.useState<string[]>(["contact.unsubscribed"]);

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await createEndpointAction({ name, url, events, description });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSecret(result.secret);
      setAdding(false);
      setName("");
      setUrl("");
      setDescription("");
      setEvents(["contact.unsubscribed"]);
      router.refresh();
    });
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.error ?? "That didn't work.");
    });
  }

  return (
    <div className="flex flex-col gap-3.5">
      {secret && <SecretOnce secret={secret} onDone={() => setSecret(null)} />}

      {endpoints.map((endpoint) => (
        <EndpointCard
          key={endpoint.id}
          endpoint={endpoint}
          pending={pending}
          onToggle={() =>
            run(() => setEndpointEnabledAction(endpoint.id, !endpoint.enabled))
          }
          onTest={() => run(() => sendTestAction(endpoint.id))}
          onDelete={() => {
            if (!window.confirm(`Delete "${endpoint.name}" and its delivery history?`)) {
              return;
            }
            run(() => deleteEndpointAction(endpoint.id));
          }}
        />
      ))}

      {adding ? (
        <Card>
          <Eyebrow className="mb-3">New endpoint</Eyebrow>
          <div className="flex max-w-[560px] flex-col gap-3">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. CRM sync"
                className="h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink"
              />
            </Field>
            <Field
              label="URL"
              help="HTTPS only. The payload carries client email addresses."
            >
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/hooks/mailflow"
                className="mono h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12px] text-ink"
              />
            </Field>
            <Field label="What to send">
              <div className="flex flex-col gap-1.5">
                {ALL_EVENTS.map((event) => {
                  const on = events.includes(event);
                  return (
                    <button
                      key={event}
                      type="button"
                      onClick={() =>
                        setEvents((prev) =>
                          on ? prev.filter((e) => e !== event) : [...prev, event],
                        )
                      }
                      aria-pressed={on}
                      className="flex items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors"
                      style={{
                        backgroundColor: on ? "#f6f8ff" : "var(--color-surface)",
                        borderColor: on ? "#8b96d8" : "var(--color-hairline)",
                      }}
                    >
                      <span
                        className="mt-[2px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border"
                        style={{
                          borderColor: on ? "#4151a8" : "var(--color-hairline-soft)",
                          backgroundColor: on ? "#4151a8" : "transparent",
                        }}
                      >
                        {on && <Check size={10} strokeWidth={3} color="#ffffff" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-semibold text-ink">
                          {WEBHOOK_EVENT_LABELS[event]}
                        </span>
                        <span className="block text-[11px] leading-relaxed text-ink-mute">
                          {WEBHOOK_EVENT_BLURBS[event]}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Note" help="Optional — what this feeds.">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink"
              />
            </Field>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={create}
                className="mf-quiet h-[34px] rounded-md px-3.5 text-[12.5px] font-bold disabled:opacity-60"
                style={{ backgroundColor: "#161461", color: "#ffffff" }}
              >
                {pending ? "Checking…" : "Add endpoint"}
              </button>
              {endpoints.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="mf-quiet h-[34px] rounded-md border border-hairline bg-surface px-3 text-[12.5px] font-semibold text-ink-soft"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mf-quiet flex h-[38px] w-fit items-center gap-1.5 rounded-md border border-dashed px-3 text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm"
          style={{ borderColor: "var(--color-hairline)" }}
        >
          <Plus size={13} strokeWidth={2} />
          Add an endpoint
        </button>
      )}

      {error && (
        <p className="text-[12px]" style={{ color: "#8a3733" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The secret, shown once.
 *
 * Deliberately awkward to dismiss — a confirm button rather than a
 * close cross — because the value is unrecoverable afterwards and
 * clicking past it by reflex costs a trip back here to make a new one.
 */
function SecretOnce({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div
      className="rounded-[10px] border px-4 py-3.5"
      style={{ backgroundColor: "#fbf6ea", borderColor: "#e5d3ab" }}
    >
      <div className="flex items-center gap-1.5">
        <CircleAlert size={14} strokeWidth={1.8} style={{ color: "#8a6a22" }} />
        <span className="text-[12.5px] font-bold text-ink">
          Copy this signing secret now
        </span>
      </div>
      <p className="mt-1 max-w-[560px] text-[11.5px] leading-relaxed text-ink-mute">
        It is not shown again. Your receiver uses it to verify that a delivery
        really came from Mailflow — without it, anything that can reach your URL
        can claim a client unsubscribed.
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <code className="mono min-w-0 flex-1 truncate rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-[11.5px] text-ink">
          {secret}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(secret).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
          className="mf-quiet flex h-[30px] shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 text-[12px] font-semibold text-ink-soft"
        >
          {copied ? <Check size={12} strokeWidth={2.4} /> : <Copy size={12} strokeWidth={1.8} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button
        type="button"
        onClick={onDone}
        className="mf-quiet mt-2.5 h-[28px] rounded-md px-3 text-[11.5px] font-bold"
        style={{ backgroundColor: "#161461", color: "#ffffff" }}
      >
        I have saved it
      </button>
    </div>
  );
}

function EndpointCard({
  endpoint,
  pending,
  onToggle,
  onTest,
  onDelete,
}: {
  endpoint: EndpointView;
  pending: boolean;
  onToggle: () => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  const failing = endpoint.consecutiveFailures >= 3;

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Webhook size={14} strokeWidth={1.7} className="shrink-0 text-brand" />
            <h3 className="text-[13.5px] font-semibold text-ink">{endpoint.name}</h3>
            {!endpoint.enabled && (
              <span className="rounded-full border px-2 py-0.5 text-[10.5px] font-semibold"
                style={{ backgroundColor: "#f4f4f1", color: "#5f636e", borderColor: "#e2e0d8" }}>
                paused
              </span>
            )}
          </div>
          <p className="mono mt-1 truncate text-[11px] text-ink-mute">{endpoint.url}</p>
          {endpoint.description && (
            <p className="mt-1 text-[11.5px] text-ink-mute">{endpoint.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {endpoint.events.map((e) => (
              <span
                key={e}
                className="rounded-full border px-2 py-0.5 text-[10.5px]"
                style={{ backgroundColor: "#f6f8ff", color: "#3b4796", borderColor: "#cfd7f5" }}
              >
                {WEBHOOK_EVENT_LABELS[e as WebhookEvent] ?? e}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onTest}
            className="mf-quiet h-[28px] rounded-md border border-hairline bg-surface px-2.5 text-[11.5px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm disabled:opacity-50"
          >
            Send a test
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onToggle}
            className="mf-quiet h-[28px] rounded-md border border-hairline bg-surface px-2.5 text-[11.5px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm disabled:opacity-50"
          >
            {endpoint.enabled ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onDelete}
            className="mf-quiet h-[28px] rounded-md border border-hairline bg-surface px-2.5 text-[11.5px] font-semibold text-ink-mute transition-colors hover:bg-paper-warm disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {failing && (
        <div
          className="mt-3 flex gap-2 rounded-md border px-3 py-2"
          style={{ backgroundColor: "#fbf0ef", borderColor: "#eccfcd" }}
        >
          <CircleAlert size={13} strokeWidth={1.8} className="mt-px shrink-0" style={{ color: "#8a4b48" }} />
          <p className="text-[11.5px] leading-relaxed text-ink-soft">
            {endpoint.consecutiveFailures} failures in a row. Deliveries are
            still being retried, but something at the other end has been down
            for a while.
          </p>
        </div>
      )}

      {endpoint.deliveries.length > 0 && (
        <div className="mt-3.5 border-t pt-2.5" style={{ borderColor: "var(--color-hairline-softer)" }}>
          <Eyebrow className="mb-1.5">Recent deliveries</Eyebrow>
          <ul className="flex flex-col gap-1">
            {endpoint.deliveries.slice(0, 8).map((d) => (
              <li key={d.id} className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2">
                  <StatusDot status={d.status} />
                  <span className="truncate text-[11.5px] text-ink-soft">
                    {WEBHOOK_EVENT_LABELS[d.event as WebhookEvent] ?? d.event}
                  </span>
                  {d.attempts > 1 && (
                    <span className="shrink-0 text-[10.5px] text-ink-faint">
                      {d.attempts} attempts
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint">
                  {d.lastStatus ?? d.lastError?.slice(0, 40) ?? "—"} ·{" "}
                  {d.createdAt.toLocaleDateString("en-AU", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

const DOT: Record<string, string> = {
  delivered: "#2f6f4a",
  pending: "#8a6a22",
  failed: "#a3423e",
  abandoned: "#a3423e",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span
      title={status}
      className="h-[7px] w-[7px] shrink-0 rounded-full"
      style={{ backgroundColor: DOT[status] ?? "#8a8d95" }}
    />
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold text-ink-soft">
        {label}
      </span>
      {help && <span className="mb-1.5 block text-[11px] text-ink-mute">{help}</span>}
      {children}
    </label>
  );
}
