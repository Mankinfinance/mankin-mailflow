import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import { MailflowContent, PageTitle } from "@/components/mailflow/MailflowPage";
import {
  SurveyGallery,
  type SurveySummary,
} from "@/components/surveys/SurveyGallery";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos } from "@/lib/db/repos";
import { SurveyConfigSchema } from "@/lib/surveys/types";

export const metadata = { title: "Surveys · Mailflow" };

/**
 * Surveys — asking clients what they thought, and counting it.
 *
 * Adjacent to Forms rather than part of it: a form's job is to create a
 * deal from a stranger, a survey's is to hear from someone already in
 * the book. Different question, different data, different screen.
 */
export default async function SurveysPage() {
  const broker = await currentBroker();

  const [rows, counts] = await Promise.all([
    repos().survey.list(),
    repos().survey.responseCounts(),
  ]);

  const surveys: SurveySummary[] = rows.map((row) => {
    const parsed = SurveyConfigSchema.safeParse(row.config);
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      /* A survey whose config no longer parses still belongs in the
         list — it has responses worth reading. It just cannot report a
         question count. */
      questions: parsed.success ? parsed.data.questions.length : 0,
      responses: counts[row.id] ?? 0,
      sent: row.sent,
      updatedAt: row.updatedAt,
    };
  });

  const live = surveys.filter((s) => s.status === "live").length;
  const answers = surveys.reduce((sum, s) => sum + s.responses, 0);

  return (
    <>
      <MailflowNav active="surveys" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar broker={{ name: broker.name, initials: broker.initials }} />
        <MailflowContent>
          <PageTitle
            title="Surveys"
            context={
              surveys.length === 0
                ? "Nothing running yet"
                : `${live} open · ${answers} ${answers === 1 ? "answer" : "answers"} in total`
            }
          />
          <SurveyGallery surveys={surveys} />
        </MailflowContent>
      </div>
    </>
  );
}
