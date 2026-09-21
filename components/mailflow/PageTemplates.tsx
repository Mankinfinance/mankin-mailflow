"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate } from "lucide-react";
import { PAGE_TEMPLATES, BLOCK_LABELS } from "@/lib/sites/types";
import { createPageAction } from "@/app/(mailflow)/marketing/landing-pages/actions";

/** The landing page gallery. Each card sketches the page's block
 *  structure rather than showing a screenshot that would go stale the
 *  first time the renderer changes. */
export function PageTemplates() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function use(templateId: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await createPageAction(templateId);
      if (result.ok) router.push(`/marketing/landing-pages/${result.id}`);
      else setError(result.error);
    });
  }

  return (
    <>
      {error && <p className="mb-3 text-[12px] text-danger">{error}</p>}
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
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
          <span className="text-[13px] font-semibold text-ink">Blank page</span>
          <span className="mt-1 text-[11.5px] leading-relaxed text-ink-mute">
            A headline and a form, then add what you need.
          </span>
        </button>

        {PAGE_TEMPLATES.map((template) => (
          <div
            key={template.id}
            className="flex flex-col rounded-[10px] border border-hairline bg-surface p-3"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            {/* Block-structure sketch: flat rectangles in the shape the
                page will actually take. */}
            <div
              className="mb-2.5 rounded-md border border-hairline p-2.5"
              style={{ backgroundColor: "#fbfaf6" }}
            >
              {template.config.blocks.slice(0, 5).map((block, i) => (
                <div key={i} className="mb-1.5 last:mb-0">
                  {block.kind === "hero" ? (
                    <>
                      <div className="h-[7px] w-[80%] rounded-[2px]" style={{ backgroundColor: "#161461" }} />
                      <div className="mt-1 h-[4px] w-[60%] rounded-[2px]" style={{ backgroundColor: "#dcdae8" }} />
                    </>
                  ) : block.kind === "form" ? (
                    <div className="rounded-[3px] border border-hairline bg-surface p-1.5">
                      <div className="h-[4px] w-[50%] rounded-[2px]" style={{ backgroundColor: "#dcdae8" }} />
                      <div className="mt-1 h-[6px] w-full rounded-[2px]" style={{ backgroundColor: "#eeecE4" }} />
                      <div className="mt-1 h-[6px] w-[45%] rounded-[2px]" style={{ backgroundColor: "#161461" }} />
                    </div>
                  ) : (
                    <>
                      <div className="h-[5px] w-[45%] rounded-[2px]" style={{ backgroundColor: "#c8c6d4" }} />
                      <div className="mt-1 h-[4px] w-full rounded-[2px]" style={{ backgroundColor: "#e8e6df" }} />
                      <div className="mt-0.5 h-[4px] w-[85%] rounded-[2px]" style={{ backgroundColor: "#e8e6df" }} />
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-brand-deep">
                {template.name}
              </h3>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: "#f3eee4", color: "#6a5b3c" }}
              >
                {template.category}
              </span>
            </div>
            <p className="mt-1 flex-1 text-[11.5px] leading-relaxed text-ink-mute">
              {template.description}
            </p>
            <p className="mt-1.5 text-[10.5px] text-ink-faint">
              {template.config.blocks.map((b) => BLOCK_LABELS[b.kind]).join(" · ")}
            </p>
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
        ))}
      </div>
    </>
  );
}
