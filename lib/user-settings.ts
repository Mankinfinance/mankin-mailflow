/**
 * Per-user dashboard preferences. Stored in browser localStorage so each
 * device has its own settings without requiring a backend. When real auth
 * + Supabase land later, we'll sync these to a user_settings row keyed by
 * the broker's id.
 *
 * Edge-safe: no server imports. Used from client components only.
 */

const STORAGE_KEY = "mankin-dashboard-settings-v1";

export type OwnerFilter = "mine" | "all" | "mm" | "na" | "rl" | "ds" | "nn" | "mp";
export type ViewFilter = "all" | "overdue" | "pending" | "complete";
export type ComposerTone = "warm" | "firm" | "final";
export type ComposerChannel = "email" | "sms";

export interface UserSettings {
  /** Default owner shown when /dashboard loads without explicit params */
  defaultOwner: OwnerFilter;
  /** Default view filter on first load */
  defaultView: ViewFilter;
  /** Default tone selected when the Composer opens (unless URL overrides) */
  composerTone: ComposerTone;
  /** Default channel for the Composer (email vs SMS) */
  composerChannel: ComposerChannel;
  /** Whether to skip the auto-redirect on first /dashboard load.
   *  Useful for brokers who prefer the default Whole team view. */
  skipDefaultRedirect: boolean;
  /** Lender ids the broker has starred. Surfaced first in the lender
   *  picker dialog and in any future "shortlist" workflows. */
  favouriteLenders: string[];
}

export const DEFAULT_SETTINGS: UserSettings = {
  defaultOwner: "mine",
  defaultView: "all",
  composerTone: "warm",
  composerChannel: "email",
  skipDefaultRedirect: false,
  favouriteLenders: [],
};

/**
 * Read settings from localStorage. Returns defaults if nothing saved
 * or the saved value is malformed.
 *
 * IMPORTANT: this function memoises the parsed result by the raw
 * localStorage string. When React's useSyncExternalStore calls this
 * as its snapshot getter, it must return the SAME object reference
 * unless the underlying storage has actually changed - otherwise
 * React believes the store changed on every render and runs into
 * Maximum update depth exceeded (error #185).
 *
 * Safe to call during SSR (returns defaults).
 */
let cachedRaw: string | null | undefined = undefined;
let cachedSettings: UserSettings = DEFAULT_SETTINGS;

export function loadSettings(): UserSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedSettings;
    cachedRaw = raw;
    if (!raw) {
      cachedSettings = DEFAULT_SETTINGS;
      return cachedSettings;
    }
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    cachedSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
    return cachedSettings;
  } catch {
    cachedSettings = DEFAULT_SETTINGS;
    return cachedSettings;
  }
}

/** Persist settings. Caller is responsible for handling any UI feedback. */
export function saveSettings(settings: UserSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // Fire a custom event so other components in the same tab can react.
    window.dispatchEvent(new CustomEvent("mankin-settings-changed"));
  } catch {
    // Quota exceeded or storage disabled — silently ignore. Settings will
    // revert to defaults on next load.
  }
}

/** Wipe persisted settings, returning to defaults. */
export function resetSettings(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("mankin-settings-changed"));
  } catch {
    // ignore
  }
}

/** Toggle a lender's favourite status. Returns the new favourites array. */
export function toggleFavouriteLender(lenderId: string): string[] {
  const current = loadSettings();
  const next = current.favouriteLenders.includes(lenderId)
    ? current.favouriteLenders.filter((id) => id !== lenderId)
    : [...current.favouriteLenders, lenderId];
  saveSettings({ ...current, favouriteLenders: next });
  return next;
}

/** Check whether a lender is favourited. SSR-safe (returns false). */
export function isFavouriteLender(lenderId: string): boolean {
  if (typeof window === "undefined") return false;
  return loadSettings().favouriteLenders.includes(lenderId);
}
