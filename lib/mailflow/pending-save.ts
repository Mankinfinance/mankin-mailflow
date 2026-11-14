/**
 * A page-wide hook for "save what's on screen first".
 *
 * The campaign editor holds unsaved changes in its own state; the
 * controls above it (Duplicate) live in a different component. Before
 * one of those acts on the saved campaign, it asks the editor to save,
 * so a copy carries what the broker just typed and nothing typed is
 * lost by navigating to the copy. Browser-only; one editor per page.
 */

type Saver = () => Promise<boolean>;
let current: Saver | null = null;

export function registerPendingSave(saver: Saver): () => void {
  current = saver;
  return () => {
    if (current === saver) current = null;
  };
}

/** Save the editor's changes, if there is an editor. False when the
 *  save failed (the editor shows why). */
export async function flushPendingSave(): Promise<boolean> {
  return current ? current() : true;
}
