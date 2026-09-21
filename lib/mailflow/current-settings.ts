import "server-only";
import { repos } from "@/lib/db/repos";
import {
  resolveSettings,
  settingsFromEnv,
  type MailflowSettings,
} from "./settings";

/**
 * The settings as they apply right now: stored value over environment
 * variable over built-in default.
 *
 * Read on every send rather than cached. A campaign clearing a
 * back-book runs across many cron invocations over hours, and a change
 * made on the settings screen halfway through should apply to the rest
 * of it — the alternative is a footer that changes meaning depending on
 * which batch someone happens to be in.
 *
 * Never throws. A settings table that is missing or unreadable falls
 * back to the environment, because failing a send over a cosmetic
 * footer setting would be the wrong trade every time.
 */
export async function currentSettings(): Promise<MailflowSettings> {
  try {
    const row = await repos().settings.get();
    return resolveSettings(row?.settings, settingsFromEnv());
  } catch (err) {
    console.error("[mailflow settings] falling back to env", err);
    return resolveSettings(null, settingsFromEnv());
  }
}
