/**
 * Merge fields in survey copy.
 *
 * A survey's headline and intro are written by a broker and can carry
 * {{first_name}} the way an email body does. The campaign renderer is
 * not reused here: that one also wraps links, appends a footer and
 * inserts a tracking pixel, none of which belongs on a web page, and
 * it runs server-only.
 *
 * Unknown fields are left as written rather than blanked. A broker who
 * typed {{lender}} into a survey headline should see that they did,
 * not a sentence with a hole in it.
 */
const FIELD = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function renderMergeFields(
  text: string,
  values: Record<string, string>,
): string {
  return text.replace(FIELD, (whole, name: string) => values[name] ?? whole);
}
