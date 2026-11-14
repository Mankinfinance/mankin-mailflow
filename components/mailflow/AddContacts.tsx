"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";
import { addContactsAction } from "@/app/(mailflow)/marketing/subscribers/actions";
import { isEmail, readContacts, type ImportPreview } from "@/lib/contacts-import";

/**
 * Add people to Mailflow's own list: one by hand, or a CSV from a
 * spreadsheet, a CRM or another email tool.
 *
 * Both ask the same two questions before anything is saved: whose
 * contacts they are (their name goes on the emails) and how we have
 * permission to email them. The second is required, because "where did
 * this list come from?" is the question a complaint starts with.
 */

const PERMISSION_SUGGESTIONS = [
  "Existing client who asked to hear from us",
  "Signed up at an event or seminar",
  "Asked for our newsletter",
  "Referral partner's clients, with their consent",
];

type Mode = "one" | "csv";

export function AddContacts({
  brokers,
  defaultBrokerId,
  dateFields = [],
}: {
  brokers: Array<{ id: string; name: string }>;
  defaultBrokerId: string;
  dateFields?: Array<{ id: string; label: string }>;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mf-quiet flex h-[31px] shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 text-[12px] font-semibold text-white"
      >
        <UserPlus size={13} strokeWidth={1.8} />
        Add contacts
      </button>
      {open && (
        <Dialog
          dateFields={dateFields}
          brokers={brokers}
          defaultBrokerId={defaultBrokerId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Dialog({
  brokers,
  defaultBrokerId,
  onClose,
  dateFields,
}: {
  dateFields: Array<{ id: string; label: string }>;
  brokers: Array<{ id: string; name: string }>;
  defaultBrokerId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>("one");
  const [one, setOne] = React.useState({ email: "", name: "", phone: "" });
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [brokerId, setBrokerId] = React.useState(defaultBrokerId);
  const [consentNote, setConsentNote] = React.useState("");
  const [result, setResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onFile(file: File | undefined) {
    setPreview(null);
    setFileError(null);
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > 5_000_000) {
      setFileError("That file is over 5 MB. Split it, or save just the name and email columns.");
      return;
    }
    const read = readContacts(await file.text(), 5000, dateFields);
    if ("error" in read) setFileError(read.error);
    else setPreview(read);
  }

  const rows =
    mode === "one"
      ? isEmail(one.email)
        ? [{ email: one.email.trim(), name: one.name, phone: one.phone }]
        : []
      : (preview?.rows ?? []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (rows.length === 0) {
      setError(mode === "one" ? "Add a valid email address." : "Choose a CSV with email addresses.");
      return;
    }
    start(async () => {
      const r = await addContactsAction({
        rows,
        consentNote,
        brokerId,
        origin: mode === "csv" ? "import" : "manual",
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const parts = [`${r.added} added`];
      if (r.alreadyOnList) parts.push(`${r.alreadyOnList} already on your list`);
      if (r.suppressed) parts.push(`${r.suppressed} had unsubscribed before and stay unsubscribed`);
      if (r.rejected) parts.push(`${r.rejected} skipped (not a valid address)`);
      if (r.datesSet) parts.push(`${r.datesSet} key ${r.datesSet === 1 ? "date" : "dates"} set`);
      setResult(parts.join(" · "));
      setOne({ email: "", name: "", phone: "" });
      setPreview(null);
      setFileName(null);
      router.refresh();
    });
  }

  const INPUT =
    "h-[34px] w-full rounded-md border border-hairline bg-surface px-2.5 text-[12.5px] text-ink placeholder:text-ink-faint";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-10"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-contacts-title"
        onSubmit={submit}
        className="w-full max-w-[520px] rounded-xl border border-hairline bg-surface p-5"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="add-contacts-title"
              className="text-[19px] text-brand-deep"
              style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
            >
              Add contacts
            </h2>
            <p className="mt-0.5 text-[11.5px] text-ink-mute">
              People who aren&apos;t in the loan book or pipeline. They join your own
              list, which a campaign can include.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-mute hover:bg-paper-warm">
            <X size={15} />
          </button>
        </div>

        <div className="mt-3.5 flex gap-1 rounded-lg bg-paper p-1" role="tablist">
          {(
            [
              ["one", "One person"],
              ["csv", "Import a CSV"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError(null);
                setResult(null);
              }}
              className="flex-1 rounded-md py-1.5 text-[12px] font-semibold"
              style={mode === m ? { backgroundColor: "#ffffff", color: "#161461" } : { color: "#5f636e" }}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "one" ? (
          <div className="mt-3.5 space-y-2.5">
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-semibold text-ink-soft">Email</span>
              <input
                type="email"
                required
                value={one.email}
                onChange={(e) => setOne({ ...one, email: e.target.value })}
                className={INPUT}
                autoFocus
              />
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-semibold text-ink-soft">Name</span>
                <input value={one.name} maxLength={120} onChange={(e) => setOne({ ...one, name: e.target.value })} className={INPUT} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-semibold text-ink-soft">Phone</span>
                <input value={one.phone} maxLength={40} onChange={(e) => setOne({ ...one, phone: e.target.value })} className={INPUT} />
              </label>
            </div>
          </div>
        ) : (
          <div className="mt-3.5">
            <label className="block cursor-pointer rounded-lg border border-dashed border-hairline px-3 py-4 text-center hover:bg-paper">
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <span className="text-[12.5px] font-semibold text-brand">
                {fileName ?? "Choose a CSV file"}
              </span>
              <span className="mt-0.5 block text-[11px] text-ink-mute">
                Needs an Email column. Name (or First and Last name), Phone and any key
                date named as in Settings (e.g. {dateFields[0]?.label ?? "Fixed rate ends"}) are
                picked up if they&apos;re there. Up to 5,000 rows.
              </span>
            </label>
            {fileError && <p className="mt-2 text-[12px] text-danger">{fileError}</p>}
            {preview && (
              <div className="mt-2.5 rounded-md bg-paper px-3 py-2.5 text-[11.5px] text-ink-soft">
                <p className="font-semibold text-ink">
                  {preview.rows.length} {preview.rows.length === 1 ? "contact" : "contacts"} ready
                </p>
                <p className="mt-0.5">
                  Using “{preview.columns.email}” for email
                  {preview.columns.name ? `, “${preview.columns.name}” for name` : ""}
                  {preview.columns.phone ? `, “${preview.columns.phone}” for phone` : ""}.
                </p>
                {preview.duplicates > 0 && <p>{preview.duplicates} repeated in the file, counted once.</p>}
                {preview.dateColumns?.map((d) => (
                  <p key={d.fieldId}>
                    “{d.heading}” sets {d.label.toLowerCase()} for {d.filled}
                    {d.unreadable > 0 ? ` (${d.unreadable} unreadable, left blank; use day/month/year)` : ""}.
                  </p>
                ))}
                {preview.invalid.length > 0 && (
                  <p>
                    {preview.invalid.length} skipped with no valid address (line
                    {preview.invalid.length > 1 ? "s" : ""}{" "}
                    {preview.invalid
                      .slice(0, 5)
                      .map((x) => x.line)
                      .join(", ")}
                    {preview.invalid.length > 5 ? "…" : ""}).
                  </p>
                )}
                {preview.rows.length > 0 && (
                  <p className="mt-1 text-ink-mute">
                    e.g. {preview.rows
                      .slice(0, 3)
                      .map((r) => (r.name ? `${r.name} <${r.email}>` : r.email))
                      .join(", ")}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-3.5 grid grid-cols-1 gap-2.5">
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-semibold text-ink-soft">Whose contacts</span>
            <select value={brokerId} onChange={(e) => setBrokerId(e.target.value)} className={INPUT}>
              {brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-semibold text-ink-soft">
              How do you have permission to email {mode === "one" ? "them" : "these people"}?
            </span>
            <input
              value={consentNote}
              maxLength={300}
              required
              placeholder="e.g. Signed up at the March first home buyer seminar"
              onChange={(e) => setConsentNote(e.target.value)}
              className={INPUT}
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PERMISSION_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setConsentNote(s)}
                className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-ink-mute hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-[10.5px] leading-relaxed text-ink-mute">
            Only add people who agreed to hear from Mankin Finance. Anyone who unsubscribed
            before stays unsubscribed.
          </p>
        </div>

        {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
        {result && (
          <p className="mt-3 text-[12px] font-semibold" style={{ color: "#2f6f4a" }}>
            {result}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-[34px] rounded-md border border-hairline px-3 text-[12px] font-semibold text-ink-soft"
          >
            {result ? "Done" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={pending || rows.length === 0}
            className="h-[34px] rounded-md bg-brand px-3.5 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {pending
              ? "Adding…"
              : mode === "one"
                ? "Add contact"
                : `Add ${rows.length || ""} ${rows.length === 1 ? "contact" : "contacts"}`.replace("  ", " ")}
          </button>
        </div>
      </form>
    </div>
  );
}
