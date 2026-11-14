import "server-only";
import { repos } from "@/lib/db/repos";

/**
 * Who a campaign must not reach: everyone on the suppression register,
 * and, when the campaign has a topic, everyone who opted out of it.
 * Kept apart so the results can say why someone was skipped.
 */
export async function blockedForCampaign(
  emails: string[],
  topicId: string | null | undefined,
): Promise<{ suppressed: Set<string>; optedOut: Set<string> }> {
  const [suppressed, optedOut] = await Promise.all([
    repos().campaign.suppressedAmong(emails),
    topicId
      ? repos().campaign.optedOutOfTopic(topicId, emails)
      : Promise.resolve(new Set<string>()),
  ]);
  return { suppressed, optedOut };
}
