import { repos } from "@/lib/db/repos";
import { verifySurveyToken } from "@/lib/surveys/token";
import { SurveyConfigSchema } from "@/lib/surveys/types";
import { SurveyForm } from "@/components/surveys/SurveyForm";
import { renderMergeFields } from "@/lib/surveys/render";

/**
 * Where a survey invitation lands.
 *
 * Same shape as the unsubscribe page and for the same reasons: no app
 * shell, no session, nothing that assumes the reader knows what
 * Mailflow is. A client reaching this has clicked a link in an email
 * from their broker, and the page should look like it came from the
 * firm rather than from a survey tool.
 *
 * Wider than the unsubscribe card because an eleven-point scale needs
 * the room.
 */

export const metadata = {
  title: "A quick question · Mankin Finance",
};

export const dynamic = "force-dynamic";

export default async function SurveyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const verified = await verifySurveyToken(token);

  const survey = verified.ok
    ? await repos().survey.get(verified.claims.sid)
    : null;
  const config =
    survey && SurveyConfigSchema.safeParse(survey.config).success
      ? SurveyConfigSchema.parse(survey.config)
      : null;

  /* Shown so they can amend rather than being told they have had their
     turn — saveResponse replaces rather than appends. */
  const existing =
    verified.ok && survey
      ? await repos().survey.findResponse(survey.id, verified.claims.em)
      : null;

  const closed = survey?.status === "closed";

  return (
    <main className="flex min-h-screen items-start justify-center bg-paper px-5 py-10">
      <div
        className="w-full max-w-[470px] rounded-2xl border border-hairline bg-surface px-[26px] py-7"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="mb-6 border-b border-hairline pb-4 text-center">
          <div
            className="text-[23px] leading-none text-brand-deep"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            Mankin.
          </div>
          <div
            className="mt-1 text-[9px] font-bold text-ink-mute"
            style={{ letterSpacing: "0.34em" }}
          >
            FINANCE
          </div>
        </div>

        {!verified.ok || !survey || !config ? (
          <Unavailable expired={verified.ok === false && verified.reason === "expired"} />
        ) : closed ? (
          <>
            <Heading>This survey has closed</Heading>
            <p className="text-[13.5px] leading-relaxed text-ink-mute">
              Thank you for coming to it. If there is something you would still
              like us to know, replying to the email reaches your broker
              directly.
            </p>
          </>
        ) : (
          <>
            <Heading>
              {renderMergeFields(config.headline, {
                first_name: firstNameOf(verified.claims.nm),
              })}
            </Heading>
            {config.intro && (
              <p className="mb-6 text-[13.5px] leading-relaxed text-ink-mute">
                {renderMergeFields(config.intro, {
                  first_name: firstNameOf(verified.claims.nm),
                })}
              </p>
            )}
            <SurveyForm
              token={token}
              config={config}
              alreadyAnswered={existing?.answers ?? null}
            />
          </>
        )}
      </div>
    </main>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h1
      className="mb-2.5 text-[24px] text-brand-deep"
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 500,
        lineHeight: 1.22,
      }}
    >
      {children}
    </h1>
  );
}

/**
 * An expired link and a forged one get different words.
 *
 * jose checks the signature before the expiry, so an expiry error means
 * the token was genuinely ours — worth saying "this has expired"
 * rather than implying they have done something wrong.
 */
function Unavailable({ expired }: { expired: boolean }) {
  return (
    <>
      <Heading>
        {expired ? "This link has expired" : "This link isn't valid"}
      </Heading>
      <p className="text-[13.5px] leading-relaxed text-ink-mute">
        {expired
          ? "Survey links last a few months, and this one is past it. If you would still like to tell us how it went, replying to the email reaches your broker directly."
          : "The link may have been altered on its way to you. Replying to the email you received will reach your broker."}
      </p>
    </>
  );
}

function firstNameOf(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || "there";
}
