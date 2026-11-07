import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { LoadFailure } from "@/lib/mailflow/load";

/** What on this page didn't load, and what to do. Nothing when all did. */
export function LoadProblems({
  failures,
  settingsLink = true,
}: {
  failures: LoadFailure[];
  settingsLink?: boolean;
}) {
  if (failures.length === 0) return null;
  const fixes = [...new Set(failures.map((f) => f.fix))];
  return (
    <section
      role="alert"
      className="mb-[22px] rounded-[10px] border border-warn bg-warn-soft px-4 py-3.5 text-warn-ink"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 text-[13px] leading-relaxed">
          <p className="font-semibold">Part of this page didn&apos;t load, so some numbers show as zero.</p>
          <ul className="mt-1.5 space-y-1">
            {failures.map((f) => (
              <li key={f.source}>
                <span className="font-semibold">{f.source}:</span> {f.message}
              </li>
            ))}
          </ul>
          {fixes.map((fix) => (
            <p key={fix} className="mt-1.5">{fix}</p>
          ))}
          {settingsLink && (
            <Link
              href="/marketing/settings#database"
              className="mt-2 inline-block font-semibold underline underline-offset-2"
            >
              Open Settings
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
