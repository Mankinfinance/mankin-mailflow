"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Card, Eyebrow } from "./MailflowPage";
import { saveSignatureAction } from "@/app/(mailflow)/marketing/settings/actions";
import { signatureFor } from "@/lib/email-signature";
import type { SignatureSettings } from "@/lib/mailflow/settings";
import { TEAM } from "@/lib/team";

/**
 * The email signature, edited where it can be seen.
 *
 * The preview is the real renderer — signatureFor, the same function
 * the sender calls — drawn into an iframe so the email's own inline
 * styles show exactly as they will, untouched by the app's stylesheet.
 *
 * Images are addresses, not uploads: they go in File manager, whose
 * copied snippet can be pasted straight into any image field here.
 */

const MAX_AWARDS = 8;

/** Accept a bare URL or File manager's "![alt](url)" snippet. */
export function imageUrlFrom(value: string): string {
  const snippet = value.trim().match(/^!\[[^\]]*\]\((https:\/\/[^)\s]+)\)$/);
  return snippet ? snippet[1] : value.trim();
}

export function SignatureForm({
  initial,
  postalAddress,
}: {
  initial: SignatureSettings;
  postalAddress: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState(initial);
  const [previewAs, setPreviewAs] = React.useState<string>(TEAM[0]?.id ?? "mm");
  const [pending, startTransition] = React.useTransition();
  const [status, setStatus] = React.useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function patch(next: Partial<SignatureSettings>) {
    setDraft((d) => ({ ...d, ...next }));
    setStatus(null);
  }

  function patchBroker(id: string, next: { title?: string; photoUrl?: string }) {
    setDraft((d) => {
      const current = d.brokers[id] ?? { title: "", photoUrl: "" };
      return { ...d, brokers: { ...d.brokers, [id]: { ...current, ...next } } };
    });
    setStatus(null);
  }

  function save() {
    startTransition(async () => {
      const result = await saveSignatureAction(draft);
      if (result.ok) {
        setStatus({ tone: "ok", text: "Saved. Every email sent from now on carries it." });
        router.refresh();
      } else {
        setStatus({ tone: "error", text: result.error });
      }
    });
  }

  const preview = React.useMemo(
    () =>
      signatureFor(previewAs, { signature: draft, postalAddress }).html,
    [draft, previewAs, postalAddress],
  );

  return (
    <div className="mt-3.5 max-w-[640px] space-y-3.5">
      <Card>
        <Eyebrow>Email signature</Eyebrow>
        <p className="mb-3.5 mt-1 text-[12px] leading-relaxed text-ink-mute">
          At the bottom of every campaign and sequence email. Upload images in{" "}
          <strong className="font-semibold">File manager</strong>, press{" "}
          <strong className="font-semibold">Copy snippet</strong>, and paste it
          into an image field here. The credit-licence lines are always added
          underneath and cannot be removed.
        </p>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <TextField label="Sign-off" value={draft.signOff} onChange={(v) => patch({ signOff: v })} placeholder="Regards" />
          <TextField label="Website" value={draft.websiteUrl} onChange={(v) => patch({ websiteUrl: v })} placeholder="https://www.mankinfinance.com.au" />
          <TextField label="Instagram profile" value={draft.instagramUrl} onChange={(v) => patch({ instagramUrl: v })} placeholder="https://www.instagram.com/…" />
          <TextField label="Instagram icon image" value={draft.instagramIconUrl} onChange={(v) => patch({ instagramIconUrl: imageUrlFrom(v) })} placeholder="Paste from File manager" />
          <TextField label="LinkedIn profile" value={draft.linkedinUrl} onChange={(v) => patch({ linkedinUrl: v })} placeholder="https://www.linkedin.com/in/…" />
          <TextField label="LinkedIn icon image" value={draft.linkedinIconUrl} onChange={(v) => patch({ linkedinIconUrl: imageUrlFrom(v) })} placeholder="Paste from File manager" />
        </div>
        <TextField
          label="Booking link words"
          value={draft.bookingLabel}
          onChange={(v) => patch({ bookingLabel: v })}
          hint="Shown only for brokers with a calendar link. It opens their own calendar."
        />
      </Card>

      <Card>
        <Eyebrow>Award badges</Eyebrow>
        <p className="mb-3 mt-1 text-[12px] leading-relaxed text-ink-mute">
          Shown in a row, in this order. The description is what a client
          reads when their email app blocks images, which most do until
          they allow them.
        </p>
        {draft.awards.map((award, i) => (
          <div key={i} className="mb-2.5 flex items-end gap-2">
            <div className="grid flex-1 gap-2 sm:grid-cols-2">
              <TextField
                label={`Badge ${i + 1} image`}
                value={award.imageUrl}
                onChange={(v) =>
                  patch({
                    awards: draft.awards.map((a, j) => (j === i ? { ...a, imageUrl: imageUrlFrom(v) } : a)),
                  })
                }
                placeholder="Paste from File manager"
                compact
              />
              <TextField
                label="Description"
                value={award.alt}
                onChange={(v) =>
                  patch({ awards: draft.awards.map((a, j) => (j === i ? { ...a, alt: v } : a)) })
                }
                placeholder="Winner, Australian Broking Awards 2024"
                compact
              />
            </div>
            <button
              type="button"
              onClick={() => patch({ awards: draft.awards.filter((_, j) => j !== i) })}
              className="mf-quiet mb-1 flex h-8 w-8 items-center justify-center rounded-md text-ink-mute hover:bg-paper-warm"
              aria-label={`Remove badge ${i + 1}`}
              title="Remove"
            >
              <Trash2 size={14} strokeWidth={1.8} />
            </button>
          </div>
        ))}
        {draft.awards.length < MAX_AWARDS && (
          <button
            type="button"
            onClick={() => patch({ awards: [...draft.awards, { imageUrl: "", alt: "" }] })}
            className="mf-quiet flex items-center gap-1.5 text-[12px] font-semibold text-brand hover:underline"
          >
            <Plus size={13} strokeWidth={2} />
            Add a badge
          </button>
        )}
      </Card>

      <Card>
        <Eyebrow>Each person</Eyebrow>
        <p className="mb-3 mt-1 text-[12px] leading-relaxed text-ink-mute">
          The title after their name, and a square headshot, shown as a
          circle. For Outlook on Windows, which cannot round a square
          image, upload the photo already cut to a circle. Anyone without
          a photo gets the same signature without the photo column.
        </p>
        {TEAM.map((member) => (
          <div key={member.id} className="mb-2.5 grid gap-2 sm:grid-cols-[120px_1fr_1fr] sm:items-end">
            <div className="pb-2 text-[12px] font-semibold text-ink">{member.name}</div>
            <TextField
              label="Title"
              value={draft.brokers[member.id]?.title ?? ""}
              onChange={(v) => patchBroker(member.id, { title: v })}
              placeholder={member.role}
              compact
            />
            <TextField
              label="Photo"
              value={draft.brokers[member.id]?.photoUrl ?? ""}
              onChange={(v) => patchBroker(member.id, { photoUrl: imageUrlFrom(v) })}
              placeholder="Paste from File manager"
              compact
            />
          </div>
        ))}
      </Card>

      <Card>
        <Eyebrow>Confidentiality note</Eyebrow>
        <textarea
          value={draft.disclaimer}
          onChange={(e) => patch({ disclaimer: e.target.value })}
          rows={4}
          aria-label="Confidentiality note"
          className="mt-2 w-full rounded-md border border-hairline bg-paper px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none focus:border-brand/50"
        />
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Preview</Eyebrow>
          <select
            value={previewAs}
            onChange={(e) => setPreviewAs(e.target.value)}
            aria-label="Preview as"
            className="rounded-md border border-hairline bg-paper px-2 py-1 text-[12px] text-ink"
          >
            {TEAM.map((m) => (
              <option key={m.id} value={m.id}>
                As {m.name}
              </option>
            ))}
          </select>
        </div>
        <iframe
          title="Signature preview"
          srcDoc={`<!doctype html><html><body style="margin:12px;background:#ffffff;">${preview}</body></html>`}
          sandbox=""
          className="mt-3 h-[640px] w-full rounded-md border border-hairline bg-white"
        />
      </Card>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="mf-quiet h-[34px] rounded-md px-3.5 text-[12.5px] font-bold transition-opacity disabled:opacity-50"
          style={{ backgroundColor: "#161461", color: "#ffffff" }}
        >
          {pending ? "Saving…" : "Save signature"}
        </button>
        {dirty && !status && <span className="text-[11.5px] text-ink-mute">Unsaved changes</span>}
        {status && (
          <span
            className="text-[11.5px]"
            style={{ color: status.tone === "ok" ? "#2f6f4a" : "#a3423e" }}
            role={status.tone === "error" ? "alert" : undefined}
          >
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  compact,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "block" : "mb-3 block"}>
      <span className="mb-1 block text-[11.5px] font-semibold text-ink">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-hairline bg-paper px-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-brand/50"
      />
      {hint && <span className="mt-1 block text-[10.5px] leading-relaxed text-ink-faint">{hint}</span>}
    </label>
  );
}
