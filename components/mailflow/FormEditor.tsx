"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import {
  FIELD_LABELS,
  FORM_TYPE_LABELS,
  type FormConfig,
  type FormField,
  type FormType,
} from "@/lib/forms/types";
import { PublicForm } from "@/components/forms/PublicForm";
import {
  deleteFormAction,
  pauseFormAction,
  publishFormAction,
  saveFormAction,
} from "@/app/(mailflow)/marketing/forms/actions";
import { Card, Eyebrow } from "./MailflowPage";

/**
 * Edit a form, see it as a customer will, and take the embed code.
 *
 * The preview is the real public component rather than a mock-up of it,
 * so what a broker approves is literally what gets rendered on the
 * website — no second implementation to drift.
 */

const ALL_FIELDS: FormField[] = ["name", "email", "phone", "loan-purpose", "message"];

export interface FormEditorProps {
  form: {
    id: string;
    name: string;
    type: FormType;
    status: string;
    config: FormConfig;
  };
  brokers: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; label: string }>;
  appUrl: string;
}

export function FormEditor({ form, brokers, stages, appUrl }: FormEditorProps) {
  const router = useRouter();
  const [name, setName] = React.useState(form.name);
  const [config, setConfig] = React.useState<FormConfig>(form.config);
  const [status, setStatus] = React.useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);
  const [pending, startTransition] = React.useTransition();

  function patch(next: Partial<FormConfig>) {
    setConfig((c) => ({ ...c, ...next }));
  }

  function toggleField(field: FormField) {
    patch({
      fields: config.fields.includes(field)
        ? config.fields.filter((f) => f !== field)
        : [...config.fields, field],
    });
  }

  async function save(): Promise<boolean> {
    const result = await saveFormAction({ id: form.id, name, config });
    if (!result.ok) setStatus({ tone: "error", text: result.error });
    return result.ok;
  }

  const hostedUrl = `${appUrl}/f/${form.id}`;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3.5">
        <Card>
          <Eyebrow className="mb-2.5">The form</Eyebrow>
          <Label>Internal name</Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT}
          />
          <div className="mt-3">
            <Label>Headline</Label>
            <input
              value={config.headline}
              onChange={(e) => patch({ headline: e.target.value })}
              className={INPUT}
            />
          </div>
          <div className="mt-3">
            <Label>Supporting line</Label>
            <textarea
              value={config.blurb}
              onChange={(e) => patch({ blurb: e.target.value })}
              rows={2}
              className={`${INPUT} py-2`}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <Label>Button</Label>
              <input
                value={config.buttonLabel}
                onChange={(e) => patch({ buttonLabel: e.target.value })}
                className={INPUT}
              />
            </div>
            <div>
              <Label>After sending</Label>
              <input
                value={config.thanks}
                onChange={(e) => patch({ thanks: e.target.value })}
                className={INPUT}
              />
            </div>
          </div>
        </Card>

        <Card>
          <Eyebrow className="mb-1">What to ask for</Eyebrow>
          <p className="mb-2.5 text-[11.5px] text-ink-mute">
            Every extra field costs completions. Anything else can be asked on
            the call.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_FIELDS.map((field) => {
              const on = config.fields.includes(field);
              return (
                <button
                  key={field}
                  type="button"
                  onClick={() => toggleField(field)}
                  className="mf-quiet rounded-full border px-2.5 py-1 text-[11.5px] transition-colors"
                  style={
                    on
                      ? {
                          backgroundColor: "#eaeefe",
                          borderColor: "#161461",
                          color: "#161461",
                          fontWeight: 700,
                        }
                      : {
                          backgroundColor: "#ffffff",
                          borderColor: "var(--color-hairline)",
                          color: "var(--color-ink-mute)",
                        }
                  }
                >
                  {FIELD_LABELS[field]}
                </button>
              );
            })}
          </div>
          <div className="mt-3">
            <Label>Consent line</Label>
            <textarea
              value={config.consent}
              onChange={(e) => patch({ consent: e.target.value })}
              rows={2}
              className={`${INPUT} py-2`}
            />
            <p className="mt-1 text-[10.5px] text-ink-mute">
              Shown under the button. Says what the person is agreeing to by
              sending — keep it accurate rather than short.
            </p>
          </div>
        </Card>

        <Card>
          <Eyebrow className="mb-1">Where the enquiry lands</Eyebrow>
          <p className="mb-2.5 text-[11.5px] text-ink-mute">
            A deal in the pipeline shows up in somebody&apos;s queue. An
            enquiry record does not, so use it only when there is genuinely
            nothing to follow up.
          </p>
          <div className="flex flex-col gap-2">
            <DestinationOption
              checked={config.destination.kind === "pipeline"}
              title="Create a deal in the loan pipeline"
              detail="The enquiry becomes a real application, assigned and ready to chase."
              onClick={() =>
                patch({
                  destination: {
                    kind: "pipeline",
                    stageId: stages[0]?.id ?? "pre-lodge",
                    brokerId: brokers[0]?.id ?? "mm",
                  },
                })
              }
            />
            <DestinationOption
              checked={config.destination.kind === "register-only"}
              title="Record the enquiry only"
              detail="For a guide download or an event list where no loan is implied."
              onClick={() => patch({ destination: { kind: "register-only" } })}
            />
          </div>

          {config.destination.kind === "pipeline" && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Label>Starting stage</Label>
                <select
                  value={config.destination.stageId}
                  onChange={(e) =>
                    patch({
                      destination: {
                        kind: "pipeline",
                        stageId: e.target.value,
                        brokerId:
                          config.destination.kind === "pipeline"
                            ? config.destination.brokerId
                            : "mm",
                      },
                    })
                  }
                  className={INPUT}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Assign to</Label>
                <select
                  value={config.destination.brokerId}
                  onChange={(e) =>
                    patch({
                      destination: {
                        kind: "pipeline",
                        stageId:
                          config.destination.kind === "pipeline"
                            ? config.destination.stageId
                            : "pre-lodge",
                        brokerId: e.target.value,
                      },
                    })
                  }
                  className={INPUT}
                >
                  {brokers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <Eyebrow className="mb-1">Put it on the website</Eyebrow>
          <p className="mb-2.5 text-[11.5px] text-ink-mute">
            {form.status === "live"
              ? "Paste this where the form should appear."
              : "Publish the form first — the snippet works once it is live."}
          </p>
          <CopyBox label="Hosted link" value={hostedUrl} />
          <div className="mt-2.5">
            <CopyBox
              label="Embed code"
              value={`<iframe src="${hostedUrl}" style="width:100%;max-width:440px;height:${embedHeight(config)}px;border:0" title="${config.headline}"></iframe>`}
              mono
            />
          </div>
        </Card>
      </div>

      {/* Live preview + publish controls */}
      <div className="space-y-3.5 lg:sticky lg:top-3.5 lg:self-start">
        <Card>
          <Eyebrow className="mb-2.5">
            How it looks · {FORM_TYPE_LABELS[form.type]}
          </Eyebrow>
          <div
            className="rounded-lg border border-hairline p-3.5"
            style={{ backgroundColor: "var(--color-paper)" }}
          >
            {/* The real component, so the preview cannot drift from
                what the website actually renders. */}
            <PublicForm formId="preview" config={config} />
          </div>
          <p className="mt-2 text-[10.5px] text-ink-faint">
            Preview only — sending here does nothing.
          </p>
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

            {form.status === "live" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await pauseFormAction(form.id);
                    router.refresh();
                  })
                }
                className="mf-quiet h-[34px] rounded-md border border-hairline bg-surface text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm disabled:opacity-50"
              >
                Take it down
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setStatus(null);
                    if (!(await save())) return;
                    const result = await publishFormAction(form.id);
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

            {form.status !== "live" && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm("Delete this form and its enquiries?")) return;
                  startTransition(async () => {
                    const result = await deleteFormAction(form.id);
                    if (result.ok) router.push("/marketing/forms");
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
    </div>
  );
}

/** Roughly how tall the iframe needs to be, so the embed does not clip
 *  its own button on first paint. */
function embedHeight(config: FormConfig): number {
  return 260 + config.fields.length * 74 + (config.blurb ? 40 : 0);
}

const INPUT =
  "w-full rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-[12.5px] text-ink";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[11.5px] font-semibold text-ink-soft">
      {children}
    </span>
  );
}

function DestinationOption({
  checked,
  title,
  detail,
  onClick,
}: {
  checked: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mf-quiet flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors"
      style={{
        backgroundColor: checked ? "#eaeefe" : "#ffffff",
        borderColor: checked ? "#161461" : "var(--color-hairline)",
      }}
    >
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
        style={{
          backgroundColor: checked ? "#161461" : "#ffffff",
          borderColor: checked ? "#161461" : "var(--color-hairline)",
        }}
      >
        {checked && <Check size={10} strokeWidth={3} color="#ffffff" />}
      </span>
      <span>
        <span
          className="block text-[12.5px] font-semibold"
          style={{ color: checked ? "#161461" : "var(--color-ink)" }}
        >
          {title}
        </span>
        <span className="block text-[11px] text-ink-mute">{detail}</span>
      </span>
    </button>
  );
}

function CopyBox({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);

  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-start gap-2">
        <code
          className={`min-w-0 flex-1 break-all rounded-md border border-hairline px-2.5 py-1.5 text-[11px] text-ink-soft ${mono ? "mono" : ""}`}
          style={{ backgroundColor: "var(--color-paper)" }}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(value).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              },
              () => setCopied(false),
            );
          }}
          className="mf-quiet flex h-[30px] shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 text-[11.5px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm"
        >
          {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.5} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
