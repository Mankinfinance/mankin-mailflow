"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Search } from "lucide-react";
import {
  FORM_CATEGORIES,
  FORM_TEMPLATES,
  FORM_TYPE_LABELS,
  type FormCategory,
  type FormType,
} from "@/lib/forms/types";
import { createFormAction } from "@/app/(mailflow)/marketing/forms/actions";

/**
 * The form template gallery, plus the two-step create flow it feeds.
 *
 * Every template here asks for as little as it can and lands somewhere a
 * broker will see it. There is no spin-to-win and no mystery discount,
 * because a mortgage is not an impulse purchase and a gimmick on a
 * credit licensee's website reads as exactly that.
 */

export function FormGallery({ activeType }: { activeType: FormType | "all" }) {
  const router = useRouter();
  const [category, setCategory] = React.useState<FormCategory | "all">("all");
  const [search, setSearch] = React.useState("");
  const [naming, setNaming] = React.useState<{
    templateId: string | null;
    type: FormType;
    suggested: string;
  } | null>(null);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const pool = FORM_TEMPLATES.filter(
    (t) => activeType === "all" || t.type === activeType,
  );

  const counts = React.useMemo(() => {
    const out: Record<string, number> = { all: pool.length };
    for (const c of FORM_CATEGORIES) {
      out[c] = pool.filter((t) => t.category === c).length;
    }
    return out;
  }, [pool]);

  const visible = pool.filter((t) => {
    if (category !== "all" && t.category !== category) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return (
      t.name.toLowerCase().includes(needle) ||
      t.description.toLowerCase().includes(needle)
    );
  });

  function begin(templateId: string | null, type: FormType, suggested: string) {
    setError(null);
    setName(suggested);
    setNaming({ templateId, type, suggested });
  }

  function create() {
    if (!naming) return;
    setError(null);
    startTransition(async () => {
      const result = await createFormAction({
        name,
        type: naming.type,
        templateId: naming.templateId,
      });
      if (result.ok) router.push(`/marketing/forms/${result.id}`);
      else setError(result.error);
    });
  }

  /* Naming is its own step rather than a field on every card: the name
     is internal, and asking for it once at the point of choosing beats
     twelve identical inputs in a grid. */
  if (naming) {
    return (
      <div
        className="max-w-[520px] rounded-[10px] border border-hairline bg-surface px-4 py-4"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <h3
          className="text-[17px] text-brand-deep"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          Name this form
        </h3>
        <p className="mt-1 text-[11.5px] text-ink-mute">
          Internal only — customers never see it. {FORM_TYPE_LABELS[naming.type]}.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          className="mt-3 h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink"
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={create}
            className="mf-quiet h-[34px] rounded-md px-3.5 text-[12.5px] font-bold transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#e3ad4b", color: "#2c1d02" }}
          >
            {pending ? "Creating…" : "Create form"}
          </button>
          <button
            type="button"
            onClick={() => setNaming(null)}
            className="mf-quiet h-[34px] rounded-md border border-hairline px-3 text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm"
          >
            Back
          </button>
          {error && <span className="text-[11.5px] text-danger">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-6">
      <div className="w-[180px] shrink-0">
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
        {FORM_CATEGORIES.map((c) => (
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
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            onClick={() =>
              begin(
                null,
                activeType === "all" ? "embedded" : activeType,
                "New form",
              )
            }
            className="mf-quiet flex flex-col items-center justify-center rounded-[10px] border border-dashed px-4 py-8 text-center transition-colors hover:bg-paper-warm"
            style={{
              borderColor: "var(--color-hairline)",
              backgroundColor: "var(--color-paper)",
            }}
          >
            <LayoutTemplate size={18} strokeWidth={1.5} className="mb-2 text-ink-mute" />
            <span className="text-[13px] font-semibold text-ink">
              Start from scratch
            </span>
            <span className="mt-1 text-[11.5px] leading-relaxed text-ink-mute">
              Choose the fields and where the enquiry lands.
            </span>
          </button>

          {visible.map((template) => (
            <div
              key={template.id}
              className="flex flex-col rounded-[10px] border border-hairline bg-surface p-3"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <FormPreview
                type={template.type}
                headline={template.config.headline}
                fields={template.config.fields.length}
                button={template.config.buttonLabel}
              />
              <div className="mt-2.5 flex items-start justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-brand-deep">
                  {template.name}
                </h3>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ backgroundColor: "#f3eee4", color: "#6a5b3c" }}
                >
                  {FORM_TYPE_LABELS[template.type]}
                </span>
              </div>
              <p className="mt-1 flex-1 text-[11.5px] leading-relaxed text-ink-mute">
                {template.description}
              </p>
              <p className="mt-1.5 text-[10.5px] text-ink-faint">
                {template.config.destination.kind === "pipeline"
                  ? "Creates a deal in the pipeline"
                  : "Records the enquiry only"}
              </p>
              <button
                type="button"
                onClick={() => begin(template.id, template.type, template.name)}
                className="mf-quiet mt-3 h-[30px] rounded-md text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#161461" }}
              >
                Use this template
              </button>
            </div>
          ))}
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

/**
 * A flat-rectangle sketch of the form, in the shape of its type. Enough
 * to tell a bar from a pop-up at a glance without shipping screenshots
 * that would go stale the first time the design moves.
 */
function FormPreview({
  type,
  headline,
  fields,
  button,
}: {
  type: FormType;
  headline: string;
  fields: number;
  button: string;
}) {
  const inner = (
    <div className="w-full">
      <div className="mb-1.5 truncate text-[8px] font-bold text-brand-deep">
        {headline}
      </div>
      {Array.from({ length: Math.min(fields, 3) }).map((_, i) => (
        <div
          key={i}
          className="mb-1 h-[7px] w-full rounded-[2px]"
          style={{ backgroundColor: "#e8e6df" }}
        />
      ))}
      <div
        className="mt-1.5 h-[9px] w-[58%] rounded-[2px]"
        style={{ backgroundColor: "#161461" }}
        title={button}
      />
    </div>
  );

  if (type === "promotion") {
    return (
      <div
        className="flex h-[92px] items-end rounded-md p-2"
        style={{ backgroundColor: "#f3f1ea" }}
      >
        <div className="w-full rounded-[3px] bg-surface px-2 py-1.5">
          <div className="truncate text-[8px] font-bold text-brand-deep">
            {headline}
          </div>
          <div
            className="mt-1 h-[7px] w-[70%] rounded-[2px]"
            style={{ backgroundColor: "#e8e6df" }}
          />
        </div>
      </div>
    );
  }

  if (type === "popup") {
    return (
      <div
        className="flex h-[92px] items-center justify-center rounded-md p-3"
        style={{ backgroundColor: "#e6e3da" }}
      >
        <div className="w-[76%] rounded-[3px] bg-surface p-2">{inner}</div>
      </div>
    );
  }

  return (
    <div
      className="h-[92px] rounded-md border border-hairline bg-surface p-2.5"
      style={{ backgroundColor: "#fbfaf6" }}
    >
      {inner}
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
