"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Cake,
  CalendarClock,
  House,
  Layers,
  Percent,
  Receipt,
  Search,
  SquarePen,
  Trash2,
  TrendingUp,
  Undo2,
} from "lucide-react";
import {
  BUILT_IN_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
} from "@/lib/templates/types";
import {
  deleteTemplateAction,
  startCampaignFromTemplateAction,
} from "@/app/(mailflow)/marketing/templates/actions";
import { Eyebrow } from "./MailflowPage";

/**
 * The email template gallery.
 *
 * Two shelves, saved above built-in. A template someone here wrote for
 * this firm, in this firm's voice, is worth more than any starting
 * point we shipped — so it goes first and the library reads as the
 * fallback it is.
 *
 * Every card starts a campaign rather than opening an editor. The
 * template is not the deliverable; the email is.
 */

const ICONS: Record<
  string,
  React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>
> = {
  "calendar-clock": CalendarClock,
  percent: Percent,
  cake: Cake,
  "trending-up": TrendingUp,
  house: House,
  layers: Layers,
  "undo-2": Undo2,
  receipt: Receipt,
};

export interface SavedTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  subject: string;
  timesUsed: number;
}

export function EmailTemplates({ saved }: { saved: SavedTemplate[] }) {
  const router = useRouter();
  const [category, setCategory] = React.useState<TemplateCategory | "all">("all");
  const [search, setSearch] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const needle = search.trim().toLowerCase();

  function matches(t: { name: string; description: string; category: string }) {
    if (category !== "all" && t.category !== category) return false;
    if (!needle) return true;
    return (
      t.name.toLowerCase().includes(needle) ||
      t.description.toLowerCase().includes(needle)
    );
  }

  const visibleSaved = saved.filter(matches);
  const visibleBuiltIn = BUILT_IN_TEMPLATES.filter(matches);

  const counts = React.useMemo(() => {
    const all = [...saved, ...BUILT_IN_TEMPLATES];
    const out: Record<string, number> = { all: all.length };
    for (const c of TEMPLATE_CATEGORIES) {
      out[c] = all.filter((t) => t.category === c).length;
    }
    return out;
  }, [saved]);

  function use(source: "saved" | "built-in", id: string) {
    setError(null);
    startTransition(async () => {
      const result = await startCampaignFromTemplateAction({ source, id });
      if (result.ok) router.push(`/marketing/campaigns/${result.campaignId}`);
      else setError(result.error);
    });
  }

  function remove(id: string, name: string) {
    if (!window.confirm(`Delete the template "${name}"? Campaigns already started from it are unaffected.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteTemplateAction(id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="flex gap-6">
      {/* Category rail */}
      <div className="w-[190px] shrink-0">
        <div className="relative mb-3">
          <Search
            size={13}
            strokeWidth={1.5}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-mute"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="h-8 w-full rounded-md border border-hairline bg-surface pl-7 pr-2.5 text-[12px] text-ink placeholder:text-ink-faint"
          />
        </div>
        <CategoryRow
          label="All templates"
          count={counts.all}
          active={category === "all"}
          onClick={() => setCategory("all")}
        />
        {TEMPLATE_CATEGORIES.map((c) => (
          <CategoryRow
            key={c}
            label={c}
            count={counts[c] ?? 0}
            active={category === c}
            onClick={() => setCategory(c)}
          />
        ))}
      </div>

      <div className="min-w-0 flex-1">
        {error && <p className="mb-3 text-[12px] text-danger">{error}</p>}

        {visibleSaved.length > 0 && (
          <>
            <Eyebrow>Saved by the team</Eyebrow>
            <div className="mb-7 mt-2 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
              {visibleSaved.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-col rounded-[10px] border border-hairline bg-surface px-4 py-4"
                  style={{ boxShadow: "var(--shadow-card)" }}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <SquarePen size={17} strokeWidth={1.5} style={{ color: "#161461" }} />
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ backgroundColor: "#eaeefe", color: "#3c4270" }}
                    >
                      {t.category}
                    </span>
                  </div>
                  <h3 className="text-[13px] font-semibold text-brand-deep">{t.name}</h3>
                  {t.description && (
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-mute">
                      {t.description}
                    </p>
                  )}
                  <p className="mono mt-2 truncate text-[10.5px] text-ink-faint">
                    {t.subject || "No subject yet"}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-ink-faint">
                    {t.timesUsed === 0
                      ? "Not used yet"
                      : `Used ${t.timesUsed} ${t.timesUsed === 1 ? "time" : "times"}`}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => use("saved", t.id)}
                      className="mf-quiet h-[30px] flex-1 rounded-md text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: "#161461" }}
                    >
                      Use this template
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(t.id, t.name)}
                      aria-label={`Delete ${t.name}`}
                      className="mf-quiet flex h-[30px] w-[30px] items-center justify-center rounded-md border border-hairline text-ink-mute transition-colors hover:bg-paper-warm disabled:opacity-50"
                    >
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <Eyebrow>Start from the library</Eyebrow>
        <p className="mb-3 mt-1 max-w-[560px] text-[12px] leading-relaxed text-ink-mute">
          Each one is an email a brokerage actually sends, written against merge
          fields the loan book can already answer. Edit anything in square
          brackets before you send — that is the part only you know.
        </p>
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {visibleBuiltIn.map((t) => {
            const Icon = ICONS[t.icon] ?? Percent;
            return (
              <div
                key={t.id}
                className="flex flex-col rounded-[10px] border border-hairline bg-surface px-4 py-4"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Icon size={17} strokeWidth={1.5} style={{ color: "#bc7d19" }} />
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: "#f3eee4", color: "#6a5b3c" }}
                  >
                    {t.category}
                  </span>
                </div>
                <h3 className="text-[13px] font-semibold text-brand-deep">{t.name}</h3>
                <p className="mt-1 flex-1 text-[11.5px] leading-relaxed text-ink-mute">
                  {t.description}
                </p>
                <p className="mono mt-2 truncate text-[10.5px] text-ink-faint">
                  {t.subject}
                </p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => use("built-in", t.id)}
                  className="mf-quiet mt-3 h-[30px] rounded-md text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: "#161461" }}
                >
                  Use this template
                </button>
              </div>
            );
          })}
        </div>

        {visibleSaved.length === 0 && visibleBuiltIn.length === 0 && (
          <p className="py-10 text-center text-[12.5px] text-ink-mute">
            No template matches that.
          </p>
        )}
      </div>
    </div>
  );
}

function CategoryRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mf-quiet flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors"
      style={
        active
          ? { backgroundColor: "#eaeefe", color: "#161461", fontWeight: 600 }
          : { color: "var(--color-ink-mute)" }
      }
    >
      {label}
      <span className="text-[11px] tabular-nums text-ink-faint">{count}</span>
    </button>
  );
}
