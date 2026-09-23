"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUp, RotateCcw, Sparkles, Square, X } from "lucide-react";

/**
 * The assistant panel: a button in the corner of every Mailflow
 * screen, and a conversation that follows the broker from page to page.
 *
 * It lives in the Mailflow layout, which App Router keeps mounted
 * across navigation, so moving from a campaign to Settings mid-question
 * does not lose the thread. Nothing is stored beyond the tab: the
 * conversation is sent with each question and forgotten when the tab
 * closes.
 */

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How did my last campaign do?",
  "Why hasn't anything been sent?",
  "How do I send a campaign?",
  "Which sequences are live, and what are they doing?",
];

export function MailflowAssistant({ firstName }: { firstName: string }) {
  const [open, setOpen] = React.useState(false);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [draft, setDraft] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [activity, setActivity] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const pathname = usePathname();
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Follow the reply as it streams in.
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, activity, error]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;

    /* An empty assistant turn is what a stopped reply leaves behind;
       the API rightly refuses one, so it is dropped rather than sent. */
    const history = [...turns, { role: "user" as const, content: text }].filter(
      (t) => t.content.trim(),
    );
    setTurns([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setError(null);
    setPending(true);
    setActivity(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, page: pathname }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "The assistant couldn't be reached.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: "text"; delta: string }
            | { type: "activity"; label: string }
            | { type: "done" }
            | { type: "error"; message: string };
          if (event.type === "text") {
            setActivity(null);
            setTurns((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + event.delta };
              return next;
            });
          } else if (event.type === "activity") {
            setActivity(event.label);
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPending(false);
      setActivity(null);
      abortRef.current = null;
      // Drop an assistant turn that never received a word.
      setTurns((prev) =>
        prev.length && !prev[prev.length - 1].content.trim()
          ? prev.slice(0, -1)
          : prev,
      );
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function startOver() {
    stop();
    setTurns([]);
    setError(null);
    setDraft("");
    inputRef.current?.focus();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mf-quiet fixed bottom-5 right-5 z-40 flex h-11 items-center gap-2 rounded-full px-4 text-[13px] font-bold shadow-lg transition-transform hover:-translate-y-0.5"
        style={{ backgroundColor: "#161461", color: "#ffffff" }}
        aria-label="Ask the Mailflow assistant"
      >
        <Sparkles size={15} strokeWidth={2} style={{ color: "#e3ad4b" }} />
        Ask Mailflow
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-label="Mailflow assistant"
      className="fixed inset-x-3 bottom-3 top-3 z-40 flex flex-col overflow-hidden rounded-xl border border-hairline bg-surface shadow-2xl sm:inset-x-auto sm:right-5 sm:top-[64px] sm:w-[400px]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={15} strokeWidth={2} style={{ color: "#bc7d19" }} />
          <div>
            <h2 className="text-[13.5px] font-bold text-ink">Mailflow assistant</h2>
            <p className="text-[10.5px] text-ink-mute">Powered by Claude</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {turns.length > 0 && (
            <IconButton label="Start over" onClick={startOver}>
              <RotateCcw size={14} strokeWidth={2} />
            </IconButton>
          )}
          <IconButton label="Close" onClick={() => setOpen(false)}>
            <X size={15} strokeWidth={2} />
          </IconButton>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {turns.length === 0 ? (
          <div>
            <p className="text-[13px] leading-relaxed text-ink-soft">
              Hi {firstName}. Ask me how to do something in Mailflow, or how your
              campaigns and sequences are going.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="mf-quiet rounded-lg border border-hairline bg-paper px-3 py-2 text-left text-[12.5px] text-ink-soft transition-colors hover:border-brand/40 hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {turns.map((t, i) =>
              t.role === "user" ? (
                <div
                  key={i}
                  className="ml-8 self-end whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-relaxed"
                  style={{ backgroundColor: "#161461", color: "#ffffff" }}
                >
                  {t.content}
                </div>
              ) : (
                <div key={i} className="mr-4 text-[13px] leading-relaxed text-ink">
                  <AssistantText text={t.content} />
                </div>
              ),
            )}
            {pending && (
              <p className="text-[11.5px] italic text-ink-mute">
                {activity ? `${activity}…` : "Thinking…"}
              </p>
            )}
          </div>
        )}

        {error && (
          <p
            className="mt-3 rounded-md border px-3 py-2 text-[12px] leading-relaxed text-ink-soft"
            style={{ backgroundColor: "#fbf0ef", borderColor: "#eccfcd" }}
            role="alert"
          >
            {error}
          </p>
        )}
      </div>

      <form
        className="border-t border-hairline px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-lg border border-hairline bg-paper px-2.5 py-2 focus-within:border-brand/50">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            rows={Math.min(5, Math.max(1, draft.split("\n").length))}
            maxLength={4000}
            placeholder="Ask about Mailflow…"
            aria-label="Your question"
            className="flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
          />
          {pending ? (
            <IconButton label="Stop" onClick={stop} solid>
              <Square size={12} strokeWidth={2.4} />
            </IconButton>
          ) : (
            <IconButton label="Send" submit solid disabled={!draft.trim()}>
              <ArrowUp size={14} strokeWidth={2.4} />
            </IconButton>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[10.5px] leading-snug text-ink-faint">
          It can look things up but can&apos;t change anything. Check anything that matters.
        </p>
      </form>
    </section>
  );
}

function IconButton({
  label,
  onClick,
  children,
  solid,
  submit,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  solid?: boolean;
  submit?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type={submit ? "submit" : "button"}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="mf-quiet flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-opacity disabled:opacity-40"
      style={
        solid
          ? { backgroundColor: "#161461", color: "#ffffff" }
          : { color: "#6a6e7a" }
      }
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Rendering a reply                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Just enough markdown for how the assistant is told to write:
 * paragraphs, bullet and numbered lists, **bold**, `code` and links.
 *
 * Built as React elements, never as HTML, so a reply cannot inject
 * markup. Links are honoured only for Mailflow's own paths — the
 * assistant is told to use nothing else, and a link it was talked into
 * producing to somewhere else renders as plain text.
 */
export function AssistantText({ text }: { text: string }) {
  return (
    <>
      {segments(text).map((seg, i) =>
        seg.kind === "ul" ? (
          <ul key={i} className="mb-2 ml-4 list-disc space-y-1 last:mb-0">
            {seg.lines.map((l, j) => (
              <li key={j}>{inline(l)}</li>
            ))}
          </ul>
        ) : seg.kind === "ol" ? (
          <ol key={i} className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">
            {seg.lines.map((l, j) => (
              <li key={j}>{inline(l)}</li>
            ))}
          </ol>
        ) : (
          <p key={i} className="mb-2 last:mb-0">
            {seg.lines.map((l, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </React.Fragment>
            ))}
          </p>
        ),
      )}
    </>
  );
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

export type Segment = { kind: "p" | "ul" | "ol"; lines: string[] };

/**
 * Split a reply into paragraphs and lists, line by line.
 *
 * Line by line rather than paragraph by paragraph, because the shape a
 * model writes most is an intro line with a list directly under it —
 * "To follow up:" then "1. …" — with no blank line between. Treating
 * that whole block as a paragraph printed the numbers as text.
 */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) {
      // A blank line ends whatever was open.
      out.push({ kind: "p", lines: [] });
      continue;
    }
    const kind = BULLET.test(raw) ? "ul" : NUMBERED.test(raw) ? "ol" : "p";
    const line = raw.replace(kind === "ul" ? BULLET : kind === "ol" ? NUMBERED : /^/, "");
    const last = out[out.length - 1];
    if (last && last.kind === kind && last.lines.length > 0) last.lines.push(line);
    else out.push({ kind, lines: [line] });
  }
  return out.filter((s) => s.lines.length > 0);
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

export function inline(line: string): React.ReactNode[] {
  return line.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="mono rounded bg-paper-warm px-1 py-px text-[11.5px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const [, label, href] = link;
      return isMailflowPath(href) ? (
        <Link key={i} href={href} className="font-semibold text-brand underline underline-offset-2">
          {label}
        </Link>
      ) : (
        <React.Fragment key={i}>{label}</React.Fragment>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

/** Mailflow's own screens only. `//host` and `/marketing.evil` are not. */
export function isMailflowPath(href: string): boolean {
  return /^\/marketing(?:[/?#]|$)/.test(href) && !href.startsWith("//");
}
