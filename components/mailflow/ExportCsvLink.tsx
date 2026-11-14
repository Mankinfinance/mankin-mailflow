import { Download } from "lucide-react";

/**
 * A plain download link to one of the CSV exports (app/api/export).
 * A link, not a button with script: the browser handles the download,
 * and it works with JavaScript off.
 */
export function ExportCsvLink({ href, label = "Export CSV" }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      download
      className="mf-quiet flex h-[31px] shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-surface px-3 text-[12px] font-semibold text-brand transition-colors hover:bg-paper-warm"
    >
      <Download size={13} strokeWidth={1.6} />
      {label}
    </a>
  );
}
