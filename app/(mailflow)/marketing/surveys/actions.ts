"use server";

import { revalidatePath } from "next/cache";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";
import { SURVEY_TEMPLATES, SurveyConfigSchema } from "@/lib/surveys/types";

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

/** Same local gate the other marketing actions use. */
async function requireAdmin(): Promise<
  { ok: true; brokerId: string } | { ok: false; error: string }
> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) {
    return { ok: false, error: "Admin access required to manage surveys." };
  }
  return { ok: true, brokerId: broker.id };
}

export async function createSurveyAction(
  templateId: string,
  name: string,
): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const template = SURVEY_TEMPLATES.find((t) => t.id === templateId);
  if (!template) return { ok: false, error: "Unknown template." };

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give it a name first." };

  const survey = await repos().survey.create({
    name: trimmed,
    status: "draft",
    config: template.config,
    createdBy: auth.brokerId,
  });

  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "survey.create",
    meta: { surveyId: survey.id, template: templateId },
  });
  revalidatePath("/marketing/surveys");
  return { ok: true, id: survey.id };
}

/**
 * Open a survey for responses, or close it.
 *
 * A closed survey still shows its results and still renders a polite
 * page for anyone arriving late on an old link — closing stops it
 * counting new answers, it does not break the link.
 */
export async function setSurveyStatusAction(
  id: string,
  status: "draft" | "live" | "closed",
): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const survey = await repos().survey.get(id);
  if (!survey) return { ok: false, error: "Survey not found." };

  if (status === "live") {
    const config = SurveyConfigSchema.safeParse(survey.config);
    if (!config.success) return { ok: false, error: "This survey could not be read." };
    if (config.data.questions.length === 0) {
      return { ok: false, error: "Add a question before opening it." };
    }
  }

  await repos().survey.update(id, { status });
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "survey.status",
    meta: { surveyId: id, status },
  });
  revalidatePath(`/marketing/surveys/${id}`);
  revalidatePath("/marketing/surveys");
  return { ok: true };
}

export async function deleteSurveyAction(id: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const survey = await repos().survey.get(id);
  if (!survey) return { ok: false, error: "Survey not found." };

  /* Responses are client feedback, so deleting is not a tidy-up — it
     destroys what people took the trouble to tell us. Only a survey
     nobody has answered can go quietly. */
  const responses = await repos().survey.listResponses(id, 1);
  if (responses.length > 0 && survey.status !== "closed") {
    return {
      ok: false,
      error: "Close it first. Deleting a survey with responses discards them.",
    };
  }

  await repos().survey.remove(id);
  await auditLog({
    actor: { type: "broker", id: auth.brokerId },
    action: "survey.delete",
    meta: { surveyId: id, name: survey.name, hadResponses: responses.length > 0 },
  });
  revalidatePath("/marketing/surveys");
  return { ok: true };
}
