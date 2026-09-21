"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CalendarCheck,
  Clock,
  Hourglass,
  House,
  LayoutTemplate,
  PartyPopper,
  Search,
  TrendingUp,
  Undo2,
} from "lucide-react";
import {
  AUTOMATION_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
} from "@/lib/automations/types";
import { describeTrigger } from "@/lib/automations/triggers";
import { createAutomationAction } from "@/app/(mailflow)/marketing/automations/actions";
import { Eyebrow } from "./MailflowPage";

/**
 * The template gallery.
 *
 * Every template here is a sequence a mortgage brokerage actually runs,
 * wired to a trigger the loan book can already answer. That is the
 * difference from a generic library: nothing in it is an abandoned cart
 * or a birthday, because a broker has neither — but they do have eight
 * hundred loans with anniversaries nobody is watching.
 *
 * Each card states its trigger and its rough volume, so the decision to
 * turn one on is made with the consequence visible.
 */

const ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>> = {
  "calendar-check": CalendarCheck,
  hourglass: Hourglass,
  house: House,
  "trending-up": TrendingUp,
  clock: Clock,
  "party-popper": PartyPopper,
  "undo-2": Undo2,
};

export function AutomationTemplates({
  stageLabels,
}: {
  stageLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [category, setCategory] = React.useState<TemplateCategory | "all">("all");
  const [search, setSearch] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const counts = React.useMemo(() => {
    const out: Record<string, number> = { all: AUTOMATION_TEMPLATES.length };
    for (const c of TEMPLATE_CATEGORIES) {
      out[c] = AUTOMATION_TEMPLATES.filter((t) => t.category === c).length;
    }
    return out;
  }, []);

  const visible = AUTOMATION_TEMPLATES.filter((t) => {
    if (category !== "all" && t.category !== category) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return (
      t.name.toLowerCase().includes(needle) ||
      t.description.toLowerCase().includes(needle)
    );
  });

  function use(templateId: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await createAutomationAction(templateId);
      if (result.ok) router.push(`/marketing/automations/${result.id}`);
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

      {/* Gallery */}
      <div className="min-w-0 flex-1">
        {error && <p className="mb-3 text-[12px] text-danger">{error}</p>}
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {/* Blank canvas first, as the escape hatch from the library. */}
          <button
            type="button"
            disabled={pending}
            onClick={() => use(null)}
            className="mf-quiet flex flex-col items-center justify-center rounded-[10px] border border-dashed px-4 py-8 text-center transition-colors hover:bg-paper-warm disabled:opacity-50"
            style={{
              borderColor: "var(--color-hairline)",
              backgroundColor: "var(--color-paper)",
            }}
          >
            <LayoutTemplate size={18} strokeWidth={1.5} className="mb-2 text-ink-mute" />
            <span className="text-[13px] font-semibold text-ink">
              Build from an empty canvas
            </span>
            <span className="mt-1 text-[11.5px] leading-relaxed text-ink-mute">
              Pick a trigger, then add delays, sends and conditions.
            </span>
          </button>

          {visible.map((template) => {
            const Icon = ICONS[template.icon] ?? CalendarCheck;
            return (
              <div
                key={template.id}
                className="flex flex-col rounded-[10px] border border-hairline bg-surface px-4 py-4"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Icon size={17} strokeWidth={1.5} style={{ color: "#bc7d19" }} />
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: "#f3eee4", color: "#6a5b3c" }}
                  >
                    {template.category}
                  </span>
                </div>
                <h3 className="text-[13px] font-semibold text-brand-deep">
                  {template.name}
                </h3>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-mute">
                  {template.description}
                </p>
                <p className="mono mt-2 text-[10.5px] text-ink-faint">
                  {describeTrigger(
                    template.flow.trigger,
                    template.flow.trigger.kind === "pipeline-stage"
                      ? stageLabels[template.flow.trigger.stageId]
                      : undefined,
                  )}
                </p>
                {template.volume && (
                  <p className="mt-0.5 text-[10.5px] text-ink-faint">
                    {template.volume}
                  </p>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => use(template.id)}
                  className="mf-quiet mt-3 h-[30px] rounded-md text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: "#161461" }}
                >
                  Use this template
                </button>
              </div>
            );
          })}
        </div>
        {visible.length === 0 && (
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

/** The section wrapper used on the empty state. */
export function TemplateGallerySection({
  stageLabels,
}: {
  stageLabels: Record<string, string>;
}) {
  return (
    <section>
      <Eyebrow className="mb-1">Start with something the book already knows</Eyebrow>
      <p className="mb-4 max-w-[620px] text-[12.5px] text-ink-mute">
        Each of these runs off data you already have — settlement dates,
        pipeline stages — so there is no list to build first.
      </p>
      <AutomationTemplates stageLabels={stageLabels} />
    </section>
  );
}
