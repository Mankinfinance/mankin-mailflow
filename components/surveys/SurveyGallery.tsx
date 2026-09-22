"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageSquareQuote, Star } from "lucide-react";
import { SURVEY_TEMPLATES } from "@/lib/surveys/types";
import { createSurveyAction } from "@/app/(mailflow)/marketing/surveys/actions";
import { Eyebrow } from "@/components/mailflow/MailflowPage";
import { StatusPill } from "@/components/mailflow/StatusPill";

/**
 * The surveys screen: what is running, and two starting points.
 *
 * Both templates are two or three questions. That is the feature, not a
 * limitation — the difference between a 40% response rate and an 11%
 * one is usually the length of the thing, and a brokerage asking six
 * questions gets the answers of the four people who had a spare
 * afternoon.
 */

export interface SurveySummary {
  id: string;
  name: string;
  status: string;
  questions: number;
  responses: number;
  sent: number;
  updatedAt: Date;
}

export function SurveyGallery({ surveys }: { surveys: SurveySummary[] }) {
  const router = useRouter();
  const [naming, setNaming] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function create(templateId: string) {
    setError(null);
    startTransition(async () => {
      const result = await createSurveyAction(templateId, name);
      if (result.ok) router.push(`/marketing/surveys/${result.id}`);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {surveys.length > 0 && (
        <div>
          <Eyebrow className="mb-2">Running</Eyebrow>
          <div className="overflow-hidden rounded-[10px] border border-hairline bg-surface">
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: "var(--color-paper-warm)" }}>
                  <Th>Survey</Th>
                  <Th>Status</Th>
                  <Th align="right">Asked</Th>
                  <Th align="right">Answered</Th>
                  <Th align="right">Rate</Th>
                </tr>
              </thead>
              <tbody>
                {surveys.map((s) => (
                  <tr
                    key={s.id}
                    className="border-t"
                    style={{ borderColor: "var(--color-hairline-softer)" }}
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/marketing/surveys/${s.id}`}
                        className="mf-quiet text-[13px] font-semibold text-ink hover:underline"
                      >
                        {s.name}
                      </Link>
                      <div className="mt-0.5 text-[10.5px] text-ink-faint">
                        {s.questions} {s.questions === 1 ? "question" : "questions"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={s.status} />
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums text-ink-soft">
                      {s.sent}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums text-ink-soft">
                      {s.responses}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums text-ink-soft">
                      {s.sent > 0 ? `${((s.responses / s.sent) * 100).toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <Eyebrow className="mb-1">Start from one of these</Eyebrow>
        <p className="mb-3 max-w-[620px] text-[12px] leading-relaxed text-ink-mute">
          Both are short on purpose. Every extra question costs answers, and a
          survey nobody finishes tells you less than a shorter one everybody
          does.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {SURVEY_TEMPLATES.map((t) => (
            <div
              key={t.id}
              className="rounded-[10px] border border-hairline bg-surface px-4 py-3.5"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="flex items-center gap-1.5">
                {t.id === "post-settlement-nps" ? (
                  <Star size={14} strokeWidth={1.6} className="text-brand" />
                ) : (
                  <MessageSquareQuote size={14} strokeWidth={1.6} className="text-brand" />
                )}
                <h3 className="text-[13.5px] font-semibold text-ink">{t.name}</h3>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-mute">
                {t.description}
              </p>
              <p className="mono mt-1.5 text-[10.5px] text-ink-faint">{t.when}</p>

              {naming === t.id ? (
                <div className="mt-3 flex gap-2">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") create(t.id);
                      if (e.key === "Escape") setNaming(null);
                    }}
                    placeholder="e.g. Settlements, Q3"
                    className="h-[32px] min-w-0 flex-1 rounded-md border border-hairline bg-surface px-2 text-[12.5px] text-ink"
                  />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => create(t.id)}
                    className="mf-quiet h-[32px] shrink-0 rounded-md px-3 text-[12px] font-bold disabled:opacity-60"
                    style={{ backgroundColor: "#161461", color: "#ffffff" }}
                  >
                    Create
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNaming(t.id);
                    setName(t.name);
                    setError(null);
                  }}
                  className="mf-quiet mt-3 h-[32px] w-full rounded-md border border-hairline bg-paper text-[12px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm"
                >
                  Use this template
                </button>
              )}
            </div>
          ))}
        </div>
        {error && (
          <p className="mt-2 text-[12px]" style={{ color: "#8a3733" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className="px-3 pb-1.5 pt-2 text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink-faint"
      style={{ textAlign: align }}
    >
      {children}
    </th>
  );
}
