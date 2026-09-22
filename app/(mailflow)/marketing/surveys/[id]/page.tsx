import { notFound } from "next/navigation";
import { MailflowNav } from "@/components/mailflow/MailflowNav";
import { MailflowTopBar } from "@/components/mailflow/MailflowTopBar";
import {
  Card,
  Eyebrow,
  MailflowContent,
  PageTitle,
} from "@/components/mailflow/MailflowPage";
import { SurveyResults } from "@/components/surveys/SurveyResults";
import { SurveyControls } from "@/components/surveys/SurveyControls";
import { currentBroker } from "@/lib/auth/current-broker";
import { repos } from "@/lib/db/repos";
import { SurveyConfigSchema } from "@/lib/surveys/types";
import { summariseSurvey } from "@/lib/surveys/scoring";

export const metadata = { title: "Survey · Mailflow" };

export default async function SurveyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const broker = await currentBroker();

  const survey = await repos().survey.get(id);
  if (!survey) notFound();

  const parsed = SurveyConfigSchema.safeParse(survey.config);
  const responses = await repos().survey.listResponses(survey.id);

  const summaries = parsed.success
    ? summariseSurvey(
        parsed.data.questions,
        responses.map((r) => ({
          email: r.email,
          name: r.name,
          answers: r.answers,
          submittedAt: r.submittedAt,
        })),
      )
    : [];

  const statusLine =
    survey.status === "live"
      ? "Open for answers"
      : survey.status === "closed"
        ? "Closed"
        : "Not open yet";

  return (
    <>
      <MailflowNav active="surveys" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MailflowTopBar broker={{ name: broker.name, initials: broker.initials }} />
        <MailflowContent>
          <div className="mb-3.5 flex items-start justify-between gap-4">
            <PageTitle
              title={survey.name}
              context={`${statusLine} · ${responses.length} ${responses.length === 1 ? "answer" : "answers"} from ${survey.sent} asked`}
            />
            <SurveyControls
              id={survey.id}
              status={survey.status}
              hasResponses={responses.length > 0}
            />
          </div>

          {!parsed.success ? (
            <p className="text-[12.5px] text-danger">
              This survey&apos;s questions could not be read. Its answers are
              still recorded.
            </p>
          ) : (
            <>
              {survey.status === "draft" && (
                <Card className="mb-3.5">
                  <Eyebrow className="mb-1.5">How this gets sent</Eyebrow>
                  <p className="max-w-[620px] text-[12px] leading-relaxed text-ink-mute">
                    A survey is not sent from here. Add a{" "}
                    <strong className="font-semibold text-ink-soft">Survey</strong>{" "}
                    step to an automation — after settlement, say — and put{" "}
                    <code className="mono rounded bg-paper-warm px-1 py-px text-[11px]">
                      {"{{survey_link}}"}
                    </code>{" "}
                    in the email body. Each client gets a link signed for them,
                    so their answer arrives with their name on it without them
                    having to sign in.
                  </p>
                  <p className="mt-2 max-w-[620px] text-[11.5px] leading-relaxed text-ink-faint">
                    Open it first — a survey that is not open records nothing.
                  </p>
                </Card>
              )}
              <SurveyResults summaries={summaries} sent={survey.sent} />
            </>
          )}
        </MailflowContent>
      </div>
    </>
  );
}
