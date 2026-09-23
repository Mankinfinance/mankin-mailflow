"use server";

import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { emitWebhook } from "@/lib/webhooks/dispatch";
import {
  SurveyAnswersSchema,
  SurveyConfigSchema,
  npsBucket,
} from "@/lib/surveys/types";
import { verifySurveyToken } from "@/lib/surveys/token";

/**
 * Record a client's answers.
 *
 * The token is re-verified here rather than trusted from the page: a
 * server action is a public endpoint, and the page having rendered is
 * not proof that this submission came from it. Nothing about who is
 * answering comes from the form — only the token says that, which is
 * what stops one client answering as another.
 */
export async function submitSurveyAction(
  token: string,
  answers: Record<string, number | string>,
): Promise<{ ok: boolean; error?: string }> {
  const verified = await verifySurveyToken(token);
  if (!verified.ok) {
    return {
      ok: false,
      error:
        verified.reason === "expired"
          ? "This link has expired. If you would still like to tell us, reply to the email instead."
          : "This link is not valid.",
    };
  }

  const survey = await repos().survey.get(verified.claims.sid);
  if (!survey) return { ok: false, error: "This survey is no longer available." };
  if (survey.status === "closed") {
    return { ok: false, error: "This survey has closed. Thank you anyway." };
  }

  const parsedAnswers = SurveyAnswersSchema.safeParse(answers);
  if (!parsedAnswers.success) {
    return { ok: false, error: "Those answers could not be read." };
  }

  const config = SurveyConfigSchema.safeParse(survey.config);
  if (!config.success) {
    return { ok: false, error: "This survey could not be read." };
  }

  /* Keep only answers to questions that exist, so a stale or tampered
     submission cannot write arbitrary keys into the row. */
  const known = new Set(config.data.questions.map((q) => q.id));
  const clean: Record<string, number | string> = {};
  for (const [id, value] of Object.entries(parsedAnswers.data)) {
    if (known.has(id)) clean[id] = value;
  }

  const missing = config.data.questions.filter(
    (q) => q.required && (clean[q.id] === undefined || clean[q.id] === ""),
  );
  if (missing.length > 0) {
    return { ok: false, error: `Please answer: ${missing[0].prompt}` };
  }

  await repos().survey.saveResponse({
    surveyId: survey.id,
    email: verified.claims.em,
    name: verified.claims.nm,
    answers: clean,
    submittedAt: new Date(),
  });

  /* After the save, not before: announcing a response that failed to
     persist would have a receiver acting on an answer nobody can find.
     Carries the score so an alert on a detractor does not require the
     receiver to know how NPS buckets work. */
  const npsQuestion = config.data.questions.find((q) => q.kind === "nps");
  const score = npsQuestion ? Number(clean[npsQuestion.id]) : null;
  /* The first free-text answer, named as the comment. Every receiver
     wants it — it is the sentence a broker reads — and picking it out
     of `answers` requires knowing this survey's question ids. */
  const commentQuestion = config.data.questions.find((q) => q.kind === "text");
  const comment = commentQuestion
    ? (clean[commentQuestion.id] ?? "")
    : "";

  const nps = score !== null && Number.isFinite(score) ? score : null;
  const response = {
    surveyId: survey.id,
    surveyName: survey.name,
    email: verified.claims.em,
    name: verified.claims.nm,
    /* From the signed link. Without it the answer names an address and
       nothing else, and the Salestrekker note has no file to go on —
       which is how survey notes first shipped: announced, never
       written. Links sent before this existed carry none. */
    dealId: verified.claims.did ?? null,
    nps,
    comment,
    answers: clean,
  };
  await emitWebhook("survey.responded", response);

  /* npsBucket rather than a threshold typed out here, so "detractor"
     means the same thing in this event as in the survey report. */
  if (nps !== null && npsBucket(Math.round(nps)) === "detractor") {
    await emitWebhook("survey.detractor", response);
  }

  /* Logged as "system" with the respondent in the metadata, because the
     audit Actor union's only customer variant is deal-scoped and a
     survey respondent is not in a deal. Reshaping a type used across
     the whole audit trail for one call site is the worse trade; the
     address is recorded either way. */
  await auditLog({
    actor: { type: "system" },
    action: "survey.respond",
    meta: {
      surveyId: survey.id,
      respondent: verified.claims.em,
      questions: Object.keys(clean).length,
    },
  });

  return { ok: true };
}
