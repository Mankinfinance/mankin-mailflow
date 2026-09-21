import type { Block } from "@/lib/sites/types";
import type { FormConfig } from "@/lib/forms/types";
import { PublicForm } from "@/components/forms/PublicForm";

/**
 * Renders a landing page's blocks.
 *
 * Shared by the public page and the editor preview, so what a broker
 * approves is what a visitor sees. Every block is responsive and on
 * brand by construction — there are no per-block style controls,
 * because a page that can be styled wrongly eventually will be.
 */

export function PageBlocks({
  blocks,
  forms,
  pageId,
}: {
  blocks: Block[];
  /** Configs for any form referenced by a form block. */
  forms: Record<string, { id: string; config: FormConfig } | undefined>;
  /** The published page these blocks belong to, so an enquiry is
   *  attributed to it. Absent in the editor preview, where a
   *  submission is not a real enquiry. */
  pageId?: string;
}) {
  return (
    <div className="space-y-10">
      {blocks.map((block, i) => (
        <BlockView
          key={`${block.kind}-${i}`}
          block={block}
          forms={forms}
          pageId={pageId}
        />
      ))}
    </div>
  );
}

function BlockView({
  block,
  forms,
  pageId,
}: {
  block: Block;
  forms: Record<string, { id: string; config: FormConfig } | undefined>;
  pageId?: string;
}) {
  switch (block.kind) {
    case "hero":
      return (
        <header>
          <h1
            className="text-[clamp(26px,4vw,38px)] leading-tight text-brand-deep"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500, letterSpacing: "-0.02em" }}
          >
            {block.heading}
          </h1>
          {block.sub && (
            <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-soft">
              {block.sub}
            </p>
          )}
        </header>
      );

    case "text":
      return (
        <section>
          {block.heading && <SectionHeading>{block.heading}</SectionHeading>}
          <p className="max-w-[600px] whitespace-pre-line text-[14px] leading-relaxed text-ink-soft">
            {block.body}
          </p>
        </section>
      );

    case "points":
      return (
        <section>
          {block.heading && <SectionHeading>{block.heading}</SectionHeading>}
          <ul className="max-w-[600px] space-y-2">
            {block.items.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-soft">
                <span
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: "#e3ad4b" }}
                />
                {item}
              </li>
            ))}
          </ul>
        </section>
      );

    case "steps":
      return (
        <section>
          {block.heading && <SectionHeading>{block.heading}</SectionHeading>}
          <ol className="max-w-[600px] space-y-3">
            {block.items.map((item, i) => (
              <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-ink-soft">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                  style={{ backgroundColor: "#eaeefe", color: "#161461" }}
                >
                  {i + 1}
                </span>
                <span className="pt-0.5">{item}</span>
              </li>
            ))}
          </ol>
        </section>
      );

    case "quote":
      return (
        <blockquote
          className="max-w-[600px] border-l-2 pl-4"
          style={{ borderColor: "#e3ad4b" }}
        >
          <p
            className="text-[17px] leading-relaxed text-ink"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            {block.quote}
          </p>
          {block.attribution && (
            <footer className="mt-2 text-[12px] text-ink-mute">
              {block.attribution}
            </footer>
          )}
        </blockquote>
      );

    case "form": {
      const form = forms[block.formId];
      return (
        <section
          className="max-w-[460px] rounded-2xl border border-hairline bg-surface px-6 py-6"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          {block.heading && (
            <h2
              className="mb-4 text-[19px] text-brand-deep"
              style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
            >
              {block.heading}
            </h2>
          )}
          {form ? (
            <PublicForm
              formId={form.id}
              config={form.config}
              compact
              pageId={pageId}
            />
          ) : (
            /* Publishing is blocked on this, so a visitor should never
               reach it — but a form deleted after publishing would, and
               a dead panel is worse than an explanation. */
            <p className="text-[13px] text-ink-mute">
              This enquiry form is unavailable. Please email{" "}
              <a
                className="font-semibold text-brand underline"
                href="mailto:support@mankinfinance.com"
              >
                support@mankinfinance.com
              </a>
              .
            </p>
          )}
        </section>
      );
    }
  }
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mb-3 text-[19px] text-brand-deep"
      style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
    >
      {children}
    </h2>
  );
}
