"use client";

import * as React from "react";
import { Check, Plus, X } from "lucide-react";
import type { AudienceFilter } from "@/lib/campaigns/types";

/**
 * The audience builder, laid out as a sentence someone is composing.
 *
 * A dozen filters rendered as a form reads bureaucratic — twelve labels,
 * twelve boxes, no indication which ones relate. Rendered as prose, the
 * same twelve read as one instruction: lead words on a fixed axis,
 * italic connectors carrying the grammar, and values as the only things
 * that look interactive.
 *
 * Two rules hold the shape steady while it is edited:
 *  - Fields never appear from nowhere and never vanish. A source that is
 *    unticked leaves its clauses dormant and dimmed, not removed, so the
 *    sentence keeps its outline and nothing below it jumps.
 *  - An unset bound is a dashed muted chip reading "no maximum", never an
 *    empty box. Blank inputs make a reader wonder whether they forgot
 *    something; a stated absence does not.
 */

export interface AudienceSentenceProps {
  value: AudienceFilter;
  onChange: (next: Partial<AudienceFilter>) => void;
  brokers: Array<{ id: string; name: string; short: string }>;
  lenderCodes: string[];
  stages: Array<{ id: string; label: string }>;
  /** Source sizes, shown on the toggle cards. */
  counts: { settlements: number; deals: number };
  /** Every tag in use, with how many contacts carry it. */
  allTags: Array<{ tag: string; count: number }>;
  /** Saved segments, offered as starting points. */
  segments: Array<{ id: string; name: string; description: string; filter: AudienceFilter }>;
  /** Replace the whole filter — used when a segment is applied. */
  onReplace: (filter: AudienceFilter) => void;
  onSaveSegment: () => void;
}

const LOAN_STATUS_LABELS: Record<string, string> = {
  active: "Settled",
  discharged: "Discharged",
  closed: "Refinanced away",
};

export function AudienceSentence({
  value,
  onChange,
  brokers,
  lenderCodes,
  stages,
  counts,
  allTags,
  segments,
  onReplace,
  onSaveSegment,
}: AudienceSentenceProps) {
  const backBookOn = value.sources.includes("settlements");
  const pipelineOn = value.sources.includes("deals");

  function toggleSource(source: "settlements" | "deals") {
    onChange({
      sources: value.sources.includes(source)
        ? value.sources.filter((s) => s !== source)
        : [...value.sources, source],
    });
  }

  function toggleIn<K extends keyof AudienceFilter>(key: K, item: string) {
    const list = value[key] as unknown as string[];
    onChange({
      [key]: list.includes(item)
        ? list.filter((x) => x !== item)
        : [...list, item],
    } as Partial<AudienceFilter>);
  }

  return (
    <div
      className="rounded-[10px] border px-[18px] py-4"
      style={{
        backgroundColor: "var(--color-paper)",
        borderColor: "var(--color-hairline-softer)",
      }}
    >
      {/* Saved segments sit above the sentence, not inside it: picking
          one rewrites every clause below, so it is a starting point
          rather than another condition. */}
      {segments.length > 0 && (
        <div className="mb-3.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Start from
          </span>
          {segments.map((seg) => (
            <button
              key={seg.id}
              type="button"
              title={seg.description || undefined}
              onClick={() => onReplace(seg.filter)}
              className="mf-quiet rounded-full border px-2.5 py-[3px] text-[11.5px] font-semibold text-brand transition-colors hover:bg-brand-soft"
              style={{ borderColor: "var(--color-hairline)" }}
            >
              {seg.name}
            </button>
          ))}
        </div>
      )}

      {/* ── The subject of the sentence: which datasets ── */}
      <Clause lead="Send to">
        <div className="flex flex-wrap gap-2">
          <SourceCard
            checked={backBookOn}
            label="the back-book"
            count={`${counts.settlements} settled loans`}
            onClick={() => toggleSource("settlements")}
          />
          <SourceCard
            checked={pipelineOn}
            label="the live pipeline"
            count={`${counts.deals} applications`}
            onClick={() => toggleSource("deals")}
          />
        </div>
      </Clause>

      {/* ── Back-book clauses, indented under their source ── */}
      <Branch active={backBookOn} hint="tick the back-book to compose these">
        <SubClause connector="whose lender is">
          {lenderCodes.length === 0 ? (
            <MutedNote>no lenders in the back-book yet</MutedNote>
          ) : (
            <ChipRow>
              {lenderCodes.map((code) => (
                <ValueChip
                  key={code}
                  selected={value.lenderCodes.includes(code)}
                  disabled={!backBookOn}
                  onClick={() => toggleIn("lenderCodes", code)}
                >
                  {code}
                </ValueChip>
              ))}
              {value.lenderCodes.length === 0 && (
                <MutedNote>any lender</MutedNote>
              )}
            </ChipRow>
          )}
        </SubClause>

        <SubClause connector="that settled between">
          <DateValue
            value={value.settledFrom}
            disabled={!backBookOn}
            placeholder="any date"
            onChange={(v) => onChange({ settledFrom: v })}
          />
          <Connector>and</Connector>
          <DateValue
            value={value.settledTo}
            disabled={!backBookOn}
            placeholder="today"
            onChange={(v) => onChange({ settledTo: v })}
          />
        </SubClause>

        <SubClause connector="still owing between">
          <MoneyValue
            value={value.minBalance}
            disabled={!backBookOn}
            placeholder="no minimum"
            onChange={(v) => onChange({ minBalance: v })}
          />
          <Connector>and</Connector>
          <MoneyValue
            value={value.maxBalance}
            disabled={!backBookOn}
            placeholder="no maximum"
            onChange={(v) => onChange({ maxBalance: v })}
          />
        </SubClause>

        <SubClause connector="whose loan is">
          <ChipRow>
            {(["active", "discharged", "closed"] as const).map((s) => (
              <ValueChip
                key={s}
                selected={value.loanStatus.includes(s)}
                disabled={!backBookOn}
                onClick={() => toggleIn("loanStatus", s)}
              >
                {LOAN_STATUS_LABELS[s]}
              </ValueChip>
            ))}
          </ChipRow>
        </SubClause>
      </Branch>

      {/* ── Pipeline clauses, present but dormant until ticked ── */}
      <Branch active={pipelineOn} hint="tick the live pipeline to compose these">
        <SubClause connector="at stage">
          <ChipRow>
            {stages.map((stage) => (
              <ValueChip
                key={stage.id}
                selected={value.stageIds.includes(stage.id)}
                disabled={!pipelineOn}
                onClick={() => toggleIn("stageIds", stage.id)}
              >
                {stage.label}
              </ValueChip>
            ))}
            {value.stageIds.length === 0 && <MutedNote>any stage</MutedNote>}
          </ChipRow>
        </SubClause>

        <SubClause connector="including deals parked on the nurture list">
          <Toggle
            checked={value.includeNurtured}
            disabled={!pipelineOn}
            onChange={(on) => onChange({ includeNurtured: on })}
          />
        </SubClause>
      </Branch>

      <div
        className="my-3.5 h-px"
        style={{ backgroundColor: "var(--color-hairline-softer)" }}
      />

      {/* ── Global clauses ── */}
      <Clause lead="Owned by">
        <ChipRow>
          <ValueChip
            selected={value.brokerIds.length === 0}
            cream
            onClick={() => onChange({ brokerIds: [] })}
          >
            Any broker · all {brokers.length}
          </ValueChip>
          {brokers.map((b) => (
            <ValueChip
              key={b.id}
              selected={value.brokerIds.includes(b.id)}
              onClick={() => toggleIn("brokerIds", b.id)}
            >
              {b.short}
            </ValueChip>
          ))}
        </ChipRow>
      </Clause>

      {allTags.length > 0 && (
        <Clause lead="Tagged">
          <ChipRow>
            <ValueChip
              selected={value.includeTags.length === 0}
              cream
              onClick={() => onChange({ includeTags: [] })}
            >
              Any tag
            </ValueChip>
            {allTags.map((t) => (
              <ValueChip
                key={t.tag}
                selected={value.includeTags.includes(t.tag)}
                onClick={() => toggleIn("includeTags", t.tag)}
              >
                {t.tag} · {t.count}
              </ValueChip>
            ))}
          </ChipRow>
          {/* Any-of, stated plainly, because "tagged investor and
              self-employed" reads as a conjunction and is not one. */}
          {value.includeTags.length > 1 && (
            <p className="mt-1 text-[10.5px] text-ink-faint">
              Anyone carrying at least one of these.
            </p>
          )}
        </Clause>
      )}

      <Clause lead="Skipping">
        {allTags.length > 0 && (
          <ChipRow>
            <ValueChip
              selected={value.excludeTags.length === 0}
              cream
              onClick={() => onChange({ excludeTags: [] })}
            >
              Nobody by tag
            </ValueChip>
            {allTags.map((t) => (
              <ValueChip
                key={t.tag}
                selected={value.excludeTags.includes(t.tag)}
                onClick={() => toggleIn("excludeTags", t.tag)}
              >
                {t.tag}
              </ValueChip>
            ))}
          </ChipRow>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Connector>anyone we contacted in the last</Connector>
          <NumberValue
            value={value.excludeContactedWithinDays}
            placeholder="never"
            onChange={(v) => onChange({ excludeContactedWithinDays: v })}
          />
          <Connector>days</Connector>
        </div>
      </Clause>

      <button
        type="button"
        onClick={onSaveSegment}
        title="Keep this audience so it can be reused, recalculating each time"
        className="mf-quiet ml-[85px] mt-1 flex items-center gap-1 text-[12px] font-semibold text-brand transition-opacity hover:opacity-70"
      >
        <Plus size={12} strokeWidth={2} />
        save this audience as a segment
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Grammar                                                                    */
/* -------------------------------------------------------------------------- */

/** Lead words sit in a fixed 74px column so every clause starts on the
 *  same axis — that alignment is what makes twelve filters read as one
 *  sentence rather than a stack of rows. */
function Clause({
  lead,
  children,
}: {
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3.5 flex items-baseline gap-3 last:mb-0">
      <span
        className="w-[74px] shrink-0 text-right text-[15px] text-ink-mute"
        style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
      >
        {lead}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A source's clauses, indented under a rule that shows they belong to
 *  it. Dormant rather than hidden when the source is off. */
function Branch({
  active,
  hint,
  children,
}: {
  active: boolean;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mf-quiet mb-3.5 ml-[74px] border-l-2 pl-3.5 transition-opacity"
      style={{
        borderColor: active ? "#c9d0f0" : "var(--color-hairline-softer)",
        opacity: active ? 1 : 0.55,
      }}
    >
      {children}
      {!active && (
        <p className="mt-1 text-[10.5px] italic text-ink-faint">{hint}</p>
      )}
    </div>
  );
}

function SubClause({
  connector,
  children,
}: {
  connector: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-1.5 last:mb-0">
      <Connector>{connector}</Connector>
      {children}
    </div>
  );
}

/** Italic navy — reads as prose, not as a field label. */
function Connector({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[15px] italic text-brand"
      style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
    >
      {children}
    </span>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <span className="flex flex-wrap items-center gap-1.5">{children}</span>;
}

function MutedNote({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded-full border border-dashed px-2 py-0.5 text-[11.5px]"
      style={{
        borderColor: "var(--color-hairline)",
        color: "var(--color-ink-placeholder)",
      }}
    >
      {children}
    </span>
  );
}

function ValueChip({
  children,
  selected,
  disabled,
  cream,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  disabled?: boolean;
  cream?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mf-quiet inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-[11.5px] transition-colors disabled:cursor-default"
      style={
        selected
          ? {
              backgroundColor: cream ? "#f3eee4" : "#eaeefe",
              borderColor: cream ? "#e5d9bd" : "#161461",
              color: cream ? "#8a6a22" : "#161461",
              fontWeight: 700,
            }
          : {
              backgroundColor: "#ffffff",
              borderColor: "var(--color-hairline)",
              color: "var(--color-ink-mute)",
            }
      }
    >
      {children}
      {selected && !cream && <X size={10} strokeWidth={2} />}
    </button>
  );
}

/** The editable-word treatment: mono value on a dashed navy underline,
 *  so a typed value looks like a word in the sentence you can change. */
function TypedValue({
  children,
  onClick,
  muted,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  muted?: boolean;
}) {
  return (
    <span
      onClick={onClick}
      className="mono inline-flex items-center rounded-[4px] border bg-surface px-1.5 py-0.5 text-[12px]"
      style={{
        borderColor: "var(--color-hairline)",
        borderBottomWidth: 2,
        borderBottomStyle: "dashed",
        borderBottomColor: "#c9d0f0",
        color: muted ? "var(--color-ink-placeholder)" : "var(--color-ink)",
      }}
    >
      {children}
    </span>
  );
}

function DateValue({
  value,
  placeholder,
  disabled,
  onChange,
}: {
  value: string | null;
  placeholder: string;
  disabled?: boolean;
  onChange: (v: string | null) => void;
}) {
  if (!value) {
    return (
      <label className="relative inline-flex">
        <MutedNote>{placeholder}</MutedNote>
        <input
          type="date"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    );
  }
  return (
    <label className="relative inline-flex">
      <TypedValue>{value}</TypedValue>
      <input
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

function MoneyValue({
  value,
  placeholder,
  disabled,
  onChange,
}: {
  value: number | null;
  placeholder: string;
  disabled?: boolean;
  onChange: (v: number | null) => void;
}) {
  const [editing, setEditing] = React.useState(false);

  if (editing || value !== null) {
    return (
      <span
        className="mono inline-flex items-center rounded-[4px] border bg-surface px-1.5 py-0.5 text-[12px]"
        style={{
          borderColor: "var(--color-hairline)",
          borderBottomWidth: 2,
          borderBottomStyle: "dashed",
          borderBottomColor: "#c9d0f0",
        }}
      >
        <span className="text-ink-mute">$</span>
        <input
          autoFocus={editing}
          type="number"
          disabled={disabled}
          value={value ?? ""}
          placeholder="0"
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
          onBlur={() => setEditing(false)}
          className="mono w-[86px] bg-transparent text-[12px] text-ink outline-none"
        />
      </span>
    );
  }

  return (
    <button type="button" disabled={disabled} onClick={() => setEditing(true)}>
      <MutedNote>{placeholder}</MutedNote>
    </button>
  );
}

function NumberValue({
  value,
  placeholder,
  onChange,
}: {
  value: number | null;
  placeholder: string;
  onChange: (v: number | null) => void;
}) {
  const [editing, setEditing] = React.useState(false);

  if (editing || value !== null) {
    return (
      <input
        autoFocus={editing}
        type="number"
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
        onBlur={() => setEditing(false)}
        className="mono w-[58px] rounded-[4px] border bg-surface px-1.5 py-0.5 text-[12px] text-ink outline-none"
        style={{
          borderColor: "var(--color-hairline)",
          borderBottomWidth: 2,
          borderBottomStyle: "dashed",
          borderBottomColor: "#c9d0f0",
        }}
      />
    );
  }

  return (
    <button type="button" onClick={() => setEditing(true)}>
      <MutedNote>{placeholder}</MutedNote>
    </button>
  );
}

function SourceCard({
  checked,
  label,
  count,
  onClick,
}: {
  checked: boolean;
  label: string;
  count: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mf-quiet flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors"
      style={{
        backgroundColor: checked ? "#eaeefe" : "#ffffff",
        borderColor: checked ? "#161461" : "var(--color-hairline)",
      }}
    >
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border"
        style={{
          backgroundColor: checked ? "#161461" : "#ffffff",
          borderColor: checked ? "#161461" : "var(--color-hairline)",
        }}
      >
        {checked && <Check size={11} strokeWidth={3} color="#ffffff" />}
      </span>
      <span>
        <span
          className="block text-[12.5px] font-semibold"
          style={{ color: checked ? "#161461" : "var(--color-ink-mute)" }}
        >
          {label}
        </span>
        <span
          className="block text-[10.5px]"
          style={{ color: checked ? "#5c6ab0" : "var(--color-ink-faint)" }}
        >
          {count}
        </span>
      </span>
    </button>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="mf-quiet relative h-[17px] w-[30px] shrink-0 rounded-full transition-colors"
      style={{ backgroundColor: checked ? "#161461" : "#d8dbe2" }}
    >
      <span
        className="mf-quiet absolute top-[2px] h-[13px] w-[13px] rounded-full bg-white transition-all"
        style={{ left: checked ? 15 : 2 }}
      />
    </button>
  );
}
