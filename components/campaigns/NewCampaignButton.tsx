"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createCampaignAction } from "@/app/(mailflow)/marketing/campaigns/actions";

/**
 * Creates a draft and drops the broker straight into the editor. The
 * name is the only thing asked for up front — everything else is easier
 * to decide with the editor's live audience count in front of you.
 */
export function NewCampaignButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createCampaignAction(name);
      if (result.ok) {
        router.push(`/marketing/campaigns/${result.id}`);
      } else {
        setError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mf-quiet h-[30px] rounded-md px-3.5 text-[12px] font-bold transition-colors"
        style={{ backgroundColor: "#e3ad4b", color: "#2c1d02" }}
      >
        New campaign
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. 2024 fixed-rate expiries"
        className="h-[30px] w-[240px] rounded-md border border-hairline px-2.5 text-[12px] text-ink placeholder:text-ink-faint"
      />
      <button
        type="submit"
        disabled={pending}
        className="mf-quiet h-[30px] rounded-md px-3 text-[12px] font-bold transition-colors disabled:opacity-50"
        style={{ backgroundColor: "#e3ad4b", color: "#2c1d02" }}
      >
        {pending ? "Creating…" : "Create"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mf-quiet h-[30px] rounded-md border border-hairline px-2.5 text-[12px] font-semibold text-ink-soft transition-colors hover:bg-paper-warm"
      >
        Cancel
      </button>
      {error && <span className="text-[11.5px] text-danger">{error}</span>}
    </form>
  );
}
