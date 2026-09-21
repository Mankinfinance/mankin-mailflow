import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import { MailflowContent, PageTitle } from "@/components/mailflow/MailflowPage";
import {
  EmailTemplates,
  type SavedTemplate,
} from "@/components/mailflow/EmailTemplates";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos } from "@/lib/db/repos";
import {
  BUILT_IN_TEMPLATES,
  TemplateConfigSchema,
} from "@/lib/templates/types";

export const metadata = { title: "Templates · Mailflow" };

/**
 * Wording written once and sent many times.
 *
 * The reason a broker's list goes quiet is rarely that they have nothing
 * to say — it is that saying it means starting from an empty box every
 * time. This page removes that.
 */
export default async function TemplatesPage() {
  const broker = await currentBroker();
  const rows = await repos().emailTemplate.list();

  const saved: SavedTemplate[] = rows.flatMap((row) => {
    const config = TemplateConfigSchema.safeParse(row.config);
    if (!config.success) return [];
    return [
      {
        id: row.id,
        name: row.name,
        description: config.data.description,
        category: config.data.category,
        subject: config.data.subject,
        timesUsed: row.timesUsed,
      },
    ];
  });

  const total = saved.length + BUILT_IN_TEMPLATES.length;

  return (
    <>
      <MailflowNav
        active="templates"
        footer={
          <p className="rounded-md border border-hairline bg-paper px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-mute">
            Using a template copies its wording into a new campaign. Editing
            the template later never changes a campaign already started from
            it.
          </p>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar broker={{ name: broker.name, initials: broker.initials }} />
        <MailflowContent>
          <PageTitle
            title="Templates"
            context={
              saved.length === 0
                ? `${BUILT_IN_TEMPLATES.length} in the library · none saved yet`
                : `${total} templates · ${saved.length} saved by the team`
            }
          />
          <EmailTemplates saved={saved} />
        </MailflowContent>
      </div>
    </>
  );
}
