import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import { MailflowContent, PageTitle } from "@/components/mailflow/MailflowPage";
import { FileManager, type StoredFile } from "@/components/mailflow/FileManager";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos } from "@/lib/db/repos";
import { formatBytes } from "@/lib/media/types";
import { portalBaseUrl } from "@/lib/portal-link";

export const metadata = { title: "File manager · Mailflow" };

/**
 * Images a campaign can use.
 *
 * Until this existed there was no way to put a picture in an email at
 * all, which is most of why the module looked thin next to MailerLite.
 */
export default async function FilesPage() {
  const broker = await currentBroker();
  const [rows, totalBytes] = await Promise.all([
    repos().media.list(),
    repos().media.totalBytes(),
  ]);

  const files: StoredFile[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    altText: row.altText,
    createdAt: row.createdAt.toISOString(),
  }));

  return (
    <>
      <MailflowNav
        active="files"
        footer={
          <p className="rounded-md border border-hairline bg-paper px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-mute">
            Images are served from this app, so the link keeps working for as
            long as the email sits in someone&apos;s inbox. Deleting one breaks
            it in every campaign already sent.
          </p>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar broker={{ name: broker.name, initials: broker.initials }} />
        <MailflowContent>
          <PageTitle
            title="File manager"
            context={
              files.length === 0
                ? "Nothing uploaded yet"
                : `${files.length} ${files.length === 1 ? "image" : "images"} · ${formatBytes(totalBytes)}`
            }
          />
          <FileManager
            files={files}
            totalBytes={totalBytes}
            baseUrl={portalBaseUrl()}
          />
        </MailflowContent>
      </div>
    </>
  );
}
