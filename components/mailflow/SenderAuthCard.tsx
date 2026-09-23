import { cn } from "@/lib/cn";
import type { AuthCheck, SenderAuth } from "@/lib/campaigns/sender-auth";
import { Card, Eyebrow } from "./MailflowPage";

/**
 * What public DNS says about the sending domain, one row per check,
 * each with its fix. Read-only: the records live at the DNS host and in
 * Microsoft 365, and the card's job is to say exactly what to change
 * there.
 */

const DOT: Record<AuthCheck["status"], string> = {
  pass: "bg-ok",
  warn: "bg-warn",
  fail: "bg-danger",
  unknown: "bg-ink-faint",
};

const WORD: Record<AuthCheck["status"], string> = {
  pass: "Passing",
  warn: "Worth fixing",
  fail: "Missing",
  unknown: "Could not check",
};

export function SenderAuthCard({ auth }: { auth: SenderAuth }) {
  const checked = new Date(auth.checkedAt).toLocaleTimeString("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <Card className="mb-3.5 max-w-[640px]">
      <div id="sending-domain" className="scroll-mt-20" />
      <Eyebrow>Sending domain</Eyebrow>
      <p className="mono mt-1 text-[13px] text-brand-deep">{auth.domain}</p>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-mute">
        Mail goes out through Microsoft 365 from each broker&apos;s own
        mailbox. Whether inboxes trust it depends on the records below, read
        from public DNS at {checked} and rechecked every half hour.
      </p>
      <ul className="mt-3 divide-y divide-hairline border-y border-hairline">
        {auth.checks.map((c) => (
          <li key={c.key} className="py-2.5">
            <div className="flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[c.status])} />
              <span className="text-[12.5px] font-semibold text-ink">{c.label}</span>
              <span className="text-[11px] text-ink-mute">{WORD[c.status]}</span>
            </div>
            <p className="mt-1 pl-3.5 text-[12px] leading-relaxed text-ink-soft">{c.detail}</p>
            {c.fix && (
              <p className="mt-1 pl-3.5 text-[11.5px] leading-relaxed text-ink-mute">
                <span className="font-semibold text-ink-soft">Fix: </span>
                {c.fix}
              </p>
            )}
            {c.record && (
              <p className="mono mt-1 break-all pl-3.5 text-[10.5px] text-ink-faint">{c.record}</p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
