"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  BLOCK_LABELS,
  type Block,
  type BlockKind,
  type PageConfig,
} from "@/lib/sites/types";
import type { FormConfig } from "@/lib/forms/types";
import { PageBlocks } from "@/components/sites/PageBlocks";
import {
  deletePageAction,
  publishPageAction,
  savePageAction,
  unpublishPageAction,
} from "@/app/(mailflow)/marketing/landing-pages/actions";
import { Card, Eyebrow } from "./MailflowPage";

/**
 * The page builder: a block list on the left, the real rendered page on
 * the right.
 *
 * Blocks are added, reordered and removed — there is no drag canvas and
 * no per-block styling. A brokerage needs a handful of pages that each
 * do one job, and a freeform builder would mean every page needs design
 * decisions nobody has time to make.
 */

const BLOCK_KINDS: BlockKind[] = ["hero", "text", "points", "steps", "quote", "form"];

export interface PageEditorProps {
  page: {
    id: string;
    name: string;
    slug: string;
    status: string;
    config: PageConfig;
  };
  /** Live forms available to embed. */
  forms: Array<{ id: string; name: string; config: FormConfig }>;
  appUrl: string;
}

export function PageEditor({ page, forms, appUrl }: PageEditorProps) {
  const router = useRouter();
  const [name, setName] = React.useState(page.name);
  const [slug, setSlug] = React.useState(page.slug);
  const [config, setConfig] = React.useState<PageConfig>(page.config);
  const [status, setStatus] = React.useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);
  const [pending, startTransition] = React.useTransition();

  const formsById = React.useMemo(
    () => Object.fromEntries(forms.map((f) => [f.id, { id: f.id, config: f.config }])),
    [forms],
  );

  function setBlock(index: number, next: Block) {
    setConfig((c) => ({
      ...c,
      blocks: c.blocks.map((b, i) => (i === index ? next : b)),
    }));
  }

  function move(index: number, delta: number) {
    setConfig((c) => {
      const next = [...c.blocks];
      const target = index + delta;
      if (target < 0 || target >= next.length) return c;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...c, blocks: next };
    });
  }

  function remove(index: number) {
    setConfig((c) => ({ ...c, blocks: c.blocks.filter((_, i) => i !== index) }));
  }

  function add(kind: BlockKind) {
    setConfig((c) => ({ ...c, blocks: [...c.blocks, blankBlock(kind)] }));
  }

  async function save(): Promise<boolean> {
    const result = await savePageAction({ id: page.id, name, slug, config });
    if (!result.ok) {
      setStatus({ tone: "error", text: result.error });
      return false;
    }
    setSlug(result.slug);
    return true;
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-3.5">
        <Card>
          <Eyebrow className="mb-2.5">Page</Eyebrow>
          <Label>Internal name</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
          <div className="mt-3">
            <Label>Web address</Label>
            <div className="flex items-center gap-1">
              <span className="mono shrink-0 text-[11.5px] text-ink-mute">/p/</span>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className={`${INPUT} mono`}
              />
            </div>
            <p className="mono mt-1 truncate text-[10.5px] text-ink-faint">
              {appUrl}/p/{slug}
            </p>
          </div>
          <div className="mt-3">
            <Label>Page title</Label>
            <input
              value={config.metaTitle}
              onChange={(e) => setConfig((c) => ({ ...c, metaTitle: e.target.value }))}
              className={INPUT}
            />
            <p className="mt-1 text-[10.5px] text-ink-mute">
              What shows in a browser tab and in search results.
            </p>
          </div>
          <div className="mt-3">
            <Label>Search description</Label>
            <textarea
              value={config.metaDescription}
              onChange={(e) =>
                setConfig((c) => ({ ...c, metaDescription: e.target.value }))
              }
              rows={2}
              className={`${INPUT} py-2`}
            />
          </div>
        </Card>

        <Card>
          <Eyebrow className="mb-2.5">Content</Eyebrow>
          <div className="space-y-2.5">
            {config.blocks.map((block, i) => (
              <BlockEditor
                key={i}
                block={block}
                forms={forms}
                onChange={(next) => setBlock(i, next)}
                onUp={i > 0 ? () => move(i, -1) : undefined}
                onDown={i < config.blocks.length - 1 ? () => move(i, 1) : undefined}
                onRemove={() => remove(i)}
              />
            ))}
          </div>

          <div className="mt-3 border-t border-hairline pt-3">
            <Label>Add a block</Label>
            <div className="flex flex-wrap gap-1.5">
              {BLOCK_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => add(kind)}
                  className="mf-quiet flex items-center gap-1 rounded-full border border-hairline bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm"
                >
                  <Plus size={11} strokeWidth={2} />
                  {BLOCK_LABELS[kind]}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setStatus(null);
                  if (await save()) setStatus({ tone: "ok", text: "Saved." });
                })
              }
              className="mf-quiet h-[34px] rounded-md border border-hairline bg-surface text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm disabled:opacity-50"
            >
              Save
            </button>
            {page.status === "published" ? (
              <>
                <a
                  href={`${appUrl}/p/${slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mf-quiet flex h-[34px] items-center justify-center rounded-md border border-hairline bg-surface text-[12.5px] font-semibold text-brand transition-colors hover:bg-paper-warm"
                >
                  View live page
                </a>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await unpublishPageAction(page.id);
                      router.refresh();
                    })
                  }
                  className="mf-quiet h-[34px] rounded-md border border-hairline bg-surface text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm disabled:opacity-50"
                >
                  Take it down
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setStatus(null);
                    if (!(await save())) return;
                    const result = await publishPageAction(page.id);
                    if (result.ok) router.refresh();
                    else setStatus({ tone: "error", text: result.error });
                  })
                }
                className="mf-quiet h-[34px] rounded-md text-[12.5px] font-bold transition-colors disabled:opacity-50"
                style={{ backgroundColor: "#e3ad4b", color: "#2c1d02" }}
              >
                Publish
              </button>
            )}
            {page.status !== "published" && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm("Delete this page?")) return;
                  startTransition(async () => {
                    const result = await deletePageAction(page.id);
                    if (result.ok) router.push("/marketing/landing-pages");
                    else setStatus({ tone: "error", text: result.error });
                  });
                }}
                className="mf-quiet h-[34px] rounded-md border border-hairline text-[12.5px] font-semibold transition-colors hover:bg-paper-warm disabled:opacity-50"
                style={{ color: "#8a4b48" }}
              >
                Delete
              </button>
            )}
          </div>
          {status && (
            <p
              className={`mt-2 text-[11.5px] font-semibold ${
                status.tone === "ok" ? "text-ok" : "text-danger"
              }`}
            >
              {status.text}
            </p>
          )}
        </Card>
      </div>

      {/* The real renderer, so the preview cannot drift from the page. */}
      <div className="lg:sticky lg:top-3.5 lg:self-start">
        <Eyebrow className="mb-2">Preview</Eyebrow>
        <div
          className="max-h-[76vh] overflow-y-auto rounded-[10px] border border-hairline bg-paper px-6 py-8"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <PageBlocks blocks={config.blocks} forms={formsById} />
        </div>
      </div>
    </div>
  );
}

function BlockEditor({
  block,
  forms,
  onChange,
  onUp,
  onDown,
  onRemove,
}: {
  block: Block;
  forms: Array<{ id: string; name: string }>;
  onChange: (next: Block) => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="rounded-lg border border-hairline px-3 py-2.5"
      style={{ backgroundColor: "var(--color-paper)" }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className="text-[10px] font-bold uppercase text-ink-faint"
          style={{ letterSpacing: "0.12em" }}
        >
          {BLOCK_LABELS[block.kind]}
        </span>
        <span className="flex items-center gap-0.5">
          <IconButton onClick={onUp} label="Move up">
            <ChevronUp size={13} strokeWidth={1.5} />
          </IconButton>
          <IconButton onClick={onDown} label="Move down">
            <ChevronDown size={13} strokeWidth={1.5} />
          </IconButton>
          <IconButton onClick={onRemove} label="Remove" danger>
            <Trash2 size={12} strokeWidth={1.5} />
          </IconButton>
        </span>
      </div>

      {block.kind === "hero" && (
        <>
          <input
            value={block.heading}
            placeholder="Headline"
            onChange={(e) => onChange({ ...block, heading: e.target.value })}
            className={INPUT}
          />
          <textarea
            value={block.sub}
            placeholder="Supporting line"
            rows={2}
            onChange={(e) => onChange({ ...block, sub: e.target.value })}
            className={`${INPUT} mt-2 py-2`}
          />
        </>
      )}

      {block.kind === "text" && (
        <>
          <input
            value={block.heading}
            placeholder="Heading"
            onChange={(e) => onChange({ ...block, heading: e.target.value })}
            className={INPUT}
          />
          <textarea
            value={block.body}
            placeholder="Paragraph"
            rows={4}
            onChange={(e) => onChange({ ...block, body: e.target.value })}
            className={`${INPUT} mt-2 py-2`}
          />
        </>
      )}

      {(block.kind === "points" || block.kind === "steps") && (
        <>
          <input
            value={block.heading}
            placeholder="Heading"
            onChange={(e) => onChange({ ...block, heading: e.target.value })}
            className={INPUT}
          />
          <textarea
            value={block.items.join("\n")}
            placeholder="One per line"
            rows={4}
            onChange={(e) =>
              onChange({
                ...block,
                items: e.target.value.split("\n").filter((l) => l.trim()),
              })
            }
            className={`${INPUT} mt-2 py-2`}
          />
          <p className="mt-1 text-[10.5px] text-ink-mute">One per line.</p>
        </>
      )}

      {block.kind === "quote" && (
        <>
          <textarea
            value={block.quote}
            placeholder="What they said"
            rows={3}
            onChange={(e) => onChange({ ...block, quote: e.target.value })}
            className={`${INPUT} py-2`}
          />
          <input
            value={block.attribution}
            placeholder="Who said it"
            onChange={(e) => onChange({ ...block, attribution: e.target.value })}
            className={`${INPUT} mt-2`}
          />
        </>
      )}

      {block.kind === "form" && (
        <>
          <input
            value={block.heading}
            placeholder="Heading above the form"
            onChange={(e) => onChange({ ...block, heading: e.target.value })}
            className={INPUT}
          />
          <select
            value={block.formId}
            onChange={(e) => onChange({ ...block, formId: e.target.value })}
            className={`${INPUT} mt-2`}
          >
            <option value="">Choose a form…</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {forms.length === 0 && (
            <p className="mt-1 text-[10.5px] text-ink-mute">
              No live forms yet — publish one in Forms first.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function blankBlock(kind: BlockKind): Block {
  switch (kind) {
    case "hero":
      return { kind, heading: "", sub: "" };
    case "text":
      return { kind, heading: "", body: "" };
    case "points":
    case "steps":
      return { kind, heading: "", items: [] };
    case "quote":
      return { kind, quote: "", attribution: "" };
    case "form":
      return { kind, heading: "", formId: "" };
  }
}

const INPUT =
  "w-full rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-faint";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[11.5px] font-semibold text-ink-soft">
      {children}
    </span>
  );
}

function IconButton({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={label}
      title={label}
      className="mf-quiet rounded p-1 transition-colors hover:bg-paper-warm disabled:opacity-30"
      style={{ color: danger ? "#8a4b48" : "var(--color-ink-mute)" }}
    >
      {children}
    </button>
  );
}
