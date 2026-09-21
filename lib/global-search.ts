/**
 * Global search ranking — powers the Cmd+K palette.
 *
 * Pure functions only — usable from both client (instant filter
 * against a passed deal list) and server (could later switch to a
 * real index without changing callers).
 *
 * Scoring is deliberately simple. For 50-100 deals + a dozen quick
 * actions we don't need TF-IDF; substring + position is plenty.
 * Higher score = sooner in the result list.
 */

/** Slim deal shape passed to the palette — keeps the payload tight. */
export interface SearchableDeal {
  id: string;
  appRef: string;
  name: string;
  email: string;
  phone: string;
  lender: string;
  stageId: string;
}

/** A static quick-action like "Open Reports". Searched alongside deals. */
export interface SearchableAction {
  id: string;
  label: string;
  /** Short hint shown under the label. */
  hint: string;
  href: string;
  /** Optional comma-separated keywords for fuzzy matching. */
  keywords?: string;
}

export interface SearchResultBase {
  id: string;
  /** Title shown bold in the result row. */
  title: string;
  /** Short subtitle under the title. */
  subtitle: string;
  /** Where pressing Enter navigates. */
  href: string;
  /** Internal ranking score; higher = sooner. */
  score: number;
}

export interface DealSearchResult extends SearchResultBase {
  kind: "deal";
  appRef: string;
}

export interface ActionSearchResult extends SearchResultBase {
  kind: "action";
}

/** A typed verb + matched deal result, like "compose Sarah Reilly". */
export interface CommandSearchResult extends SearchResultBase {
  kind: "command";
  /** The verb the user typed (compose, open, etc) — drives the row icon. */
  verb: CommandVerb;
}

export type SearchResult = DealSearchResult | ActionSearchResult | CommandSearchResult;

export interface SearchOutput {
  /** Commands surface above everything when a verb is detected. */
  commands: CommandSearchResult[];
  /** Deal hits, sorted by score desc. */
  deals: DealSearchResult[];
  /** Quick-action hits, sorted by score desc. */
  actions: ActionSearchResult[];
  /** Total = commands + deals + actions, for empty-state checks. */
  total: number;
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

const SCORE_EXACT_MATCH = 1000;
const SCORE_PREFIX_MATCH = 500;
const SCORE_WORD_BOUNDARY = 200;
const SCORE_SUBSTRING = 50;

/**
 * Score one string against a normalised lower-case query token. 0 if no
 * match, higher = closer match.
 *
 *   "MF-2410" vs "mf-2410"  → 1000 (exact)
 *   "Sarah & Tom Reilly" vs "sarah"  → 500 (prefix)
 *   "Sarah & Tom Reilly" vs "reilly"  → 200 (word boundary)
 *   "0411 234 567" vs "234"  → 50  (substring)
 */
function scoreField(field: string, queryLower: string): number {
  if (!field) return 0;
  const fieldLower = field.toLowerCase();
  if (fieldLower === queryLower) return SCORE_EXACT_MATCH;
  if (fieldLower.startsWith(queryLower)) return SCORE_PREFIX_MATCH;
  // Word-boundary: any non-alphanumeric followed by the query is a match.
  const wordBoundaryRe = new RegExp(
    `(^|[^a-z0-9])${queryLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
  if (wordBoundaryRe.test(fieldLower)) return SCORE_WORD_BOUNDARY;
  if (fieldLower.includes(queryLower)) return SCORE_SUBSTRING;
  return 0;
}

function scoreDeal(deal: SearchableDeal, queryLower: string): number {
  // Each field weighted: name (2x), appRef (3x — high signal), email (1x),
  // phone (1x), lender (0.5x — last-resort match).
  return (
    scoreField(deal.name, queryLower) * 2 +
    scoreField(deal.appRef, queryLower) * 3 +
    scoreField(deal.email, queryLower) +
    scoreField(deal.phone.replace(/\s+/g, ""), queryLower.replace(/\s+/g, "")) +
    Math.round(scoreField(deal.lender, queryLower) * 0.5)
  );
}

function scoreAction(action: SearchableAction, queryLower: string): number {
  return (
    scoreField(action.label, queryLower) * 2 +
    scoreField(action.hint, queryLower) +
    (action.keywords ? scoreField(action.keywords, queryLower) : 0)
  );
}

/* -------------------------------------------------------------------------- */
/* Command parser                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Verbs the user can prefix a deal name with to jump straight into an
 * action — "compose Sarah" opens Sarah's deal AND opens the composer
 * in one keystroke pattern. The href template gets the deal id
 * substituted at result-build time.
 */
export type CommandVerb =
  | "open"
  | "compose"
  | "send"
  | "chase"
  | "note"
  | "portal"
  | "kanban-of";

interface CommandSpec {
  verbs: string[];
  /** Friendly label template; {name} substituted at build time. */
  labelTemplate: string;
  /** Sub-label / hint shown under the title. */
  hint: string;
  /** Pretty icon char rendered in the result row. */
  icon: string;
  /** href template; {id} substituted at build time. */
  hrefTemplate: string;
}

const COMMAND_SPECS: Record<CommandVerb, CommandSpec> = {
  open: {
    verbs: ["open", "show", "view", "go", "jump"],
    labelTemplate: "Open {name}",
    hint: "Jump to the deal in the drawer",
    icon: "→",
    hrefTemplate: "/dashboard?deal={id}",
  },
  compose: {
    verbs: ["compose", "write", "draft", "msg", "message", "email"],
    labelTemplate: "Compose a follow-up to {name}",
    hint: "Opens the deal + composer (warm tone)",
    icon: "✉",
    hrefTemplate: "/dashboard?deal={id}&compose={id}",
  },
  send: {
    verbs: ["send", "followup", "follow-up", "follow"],
    labelTemplate: "Send follow-up to {name}",
    hint: "Same as compose — opens the composer ready to send",
    icon: "✉",
    hrefTemplate: "/dashboard?deal={id}&compose={id}",
  },
  chase: {
    verbs: ["chase", "nudge", "ping", "remind"],
    labelTemplate: "Chase {name}",
    hint: "Opens the deal + composer in firm tone",
    icon: "🔥",
    hrefTemplate: "/dashboard?deal={id}&compose={id}&channel=email&tone=firm",
  },
  note: {
    verbs: ["note", "log", "comment"],
    labelTemplate: "Add a note on {name}",
    hint: "Opens the deal + note dialog",
    icon: "✎",
    hrefTemplate: "/dashboard?deal={id}&note={id}",
  },
  portal: {
    verbs: ["portal", "link"],
    labelTemplate: "Issue portal link for {name}",
    hint: "Opens the deal — hit the Portal link button",
    icon: "🔗",
    hrefTemplate: "/dashboard?deal={id}",
  },
  "kanban-of": {
    verbs: ["kanban", "board"],
    labelTemplate: "Show {name} on Kanban",
    hint: "Opens the Kanban board with this deal selected",
    icon: "▦",
    hrefTemplate: "/dashboard/kanban?deal={id}",
  },
};

/** Flat verb → spec lookup. */
const VERB_TO_SPEC: Record<string, { verb: CommandVerb; spec: CommandSpec }> = {};
for (const [key, spec] of Object.entries(COMMAND_SPECS) as Array<
  [CommandVerb, CommandSpec]
>) {
  for (const v of spec.verbs) {
    VERB_TO_SPEC[v] = { verb: key, spec };
  }
}

/**
 * Detect if the query starts with a command verb. Returns the verb +
 * the remaining "noun" (deal name fragment).
 */
function detectCommand(
  queryLower: string,
): { verb: CommandVerb; spec: CommandSpec; noun: string } | null {
  const trimmed = queryLower.trim();
  if (!trimmed) return null;
  const firstSpace = trimmed.indexOf(" ");
  // No space = single word, could only be a navigation verb without target.
  if (firstSpace === -1) return null;
  const head = trimmed.slice(0, firstSpace);
  const tail = trimmed.slice(firstSpace + 1).trim();
  if (!tail) return null;
  const hit = VERB_TO_SPEC[head];
  if (!hit) return null;
  return { verb: hit.verb, spec: hit.spec, noun: tail };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export function search(args: {
  query: string;
  deals: SearchableDeal[];
  actions: SearchableAction[];
  limitDeals?: number;
  limitActions?: number;
  limitCommands?: number;
}): SearchOutput {
  const queryLower = args.query.trim().toLowerCase();

  if (queryLower.length === 0) {
    // Empty query — show top quick actions only, no deals
    const actions = args.actions.slice(0, args.limitActions ?? 6).map(
      (a, i): ActionSearchResult => ({
        kind: "action",
        id: a.id,
        title: a.label,
        subtitle: a.hint,
        href: a.href,
        score: 100 - i,
      }),
    );
    return { commands: [], deals: [], actions, total: actions.length };
  }

  /* Command detection — if the user typed "compose <name>" we build a
     synthetic top result that combines the verb + best-matching deal. */
  const commandHits: CommandSearchResult[] = [];
  const command = detectCommand(queryLower);
  if (command) {
    // Score every deal against the noun portion only; surface the top 3.
    const dealMatches = args.deals
      .map((d) => ({ deal: d, score: scoreDeal(d, command.noun) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, args.limitCommands ?? 3);

    for (const { deal, score } of dealMatches) {
      commandHits.push({
        kind: "command",
        verb: command.verb,
        id: `cmd-${command.verb}-${deal.id}`,
        title: command.spec.labelTemplate.replace("{name}", deal.name),
        subtitle: `${command.spec.hint} · ${deal.appRef}`,
        href: command.spec.hrefTemplate.replace(/\{id\}/g, deal.id),
        // Commands rank above the deal-only result for the same deal.
        score: score + SCORE_EXACT_MATCH * 2,
      });
    }
  }

  const dealHits: DealSearchResult[] = [];
  // When a command is matched, search by the noun; otherwise the whole query.
  const dealQuery = command ? command.noun : queryLower;
  for (const deal of args.deals) {
    const score = scoreDeal(deal, dealQuery);
    if (score === 0) continue;
    dealHits.push({
      kind: "deal",
      id: deal.id,
      title: deal.name,
      subtitle: `${deal.appRef} · ${deal.lender} · ${deal.email}`,
      href: `/dashboard?deal=${deal.id}`,
      score,
      appRef: deal.appRef,
    });
  }
  dealHits.sort((a, b) => b.score - a.score);

  const actionHits: ActionSearchResult[] = [];
  for (const action of args.actions) {
    const score = scoreAction(action, queryLower);
    if (score === 0) continue;
    actionHits.push({
      kind: "action",
      id: action.id,
      title: action.label,
      subtitle: action.hint,
      href: action.href,
      score,
    });
  }
  actionHits.sort((a, b) => b.score - a.score);

  return {
    commands: commandHits,
    deals: dealHits.slice(0, args.limitDeals ?? 10),
    actions: actionHits.slice(0, args.limitActions ?? 5),
    total: commandHits.length + dealHits.length + actionHits.length,
  };
}

/** Verb → icon for the result row. */
export function iconForCommand(verb: CommandVerb): string {
  return COMMAND_SPECS[verb].icon;
}

/* -------------------------------------------------------------------------- */
/* Quick actions — the static palette below the deal results                  */
/* -------------------------------------------------------------------------- */

export const QUICK_ACTIONS: SearchableAction[] = [
  {
    id: "at-risk",
    label: "Show at-risk deals",
    hint: "Filter pipeline to critical and high-risk deals only",
    href: "/dashboard?risk=1",
    keywords: "risk critical high danger urgent filter pipeline at-risk",
  },
  {
    id: "today",
    label: "Open Today's queue",
    hint: "Prescriptive list of what needs you now",
    href: "/dashboard/today",
    keywords: "morning brief urgent action critical",
  },
  {
    id: "overview",
    label: "Open Overview",
    hint: "KPI dashboard mirroring the pipeline spreadsheet",
    href: "/dashboard/overview",
    keywords: "kpi dashboard summary numbers",
  },
  {
    id: "kanban",
    label: "Open Kanban board",
    hint: "Salestrekker B.1-B.7 board with drag-and-drop",
    href: "/dashboard/kanban",
    keywords: "pipeline stages columns board",
  },
  {
    id: "pipeline",
    label: "Open Pipeline list",
    hint: "Full open pipeline with filters",
    href: "/dashboard",
    keywords: "deals list filter",
  },
  {
    id: "nurture",
    label: "Open Nurture list",
    hint: "Deals parked out of the active pipeline",
    href: "/dashboard/nurture",
    keywords: "park hold long-term sleep",
  },
  {
    id: "reports",
    label: "Open Reports",
    hint: "Settlements, capacity trend, productivity",
    href: "/reports",
    keywords: "stats analytics charts forecast",
  },
  {
    id: "templates",
    label: "Open Templates",
    hint: "Email + SMS templates the team uses",
    href: "/templates",
    keywords: "email sms drafts presets",
  },
  {
    id: "audit",
    label: "Open Audit log",
    hint: "Compliance trail of every sensitive action",
    href: "/audit",
    keywords: "compliance asic rg209 history events",
  },

  /* CX Manager surfaces */
  {
    id: "cx",
    label: "Switch to CX Manager",
    hint: "Back-book + anniversaries + reviews · separate workspace",
    href: "/cx",
    keywords: "customer experience cx manager backbook trail",
  },
  {
    id: "cx-anniversaries",
    label: "Anniversaries (CX)",
    hint: "3/6/12/18/24 month review queue",
    href: "/cx/anniversaries",
    keywords: "cx review touchpoint milestone settle anniversary",
  },
  {
    id: "cx-backbook",
    label: "Back-book (CX)",
    hint: "Every settled loan from the YBR commission XLSX",
    href: "/cx/backbook",
    keywords: "cx backbook settled loans book trail",
  },
  {
    id: "cx-tenured",
    label: "Tenured book · 18mo+",
    hint: "Long-tenured clients — retention focus",
    href: "/cx/backbook?tenured=18",
    keywords: "cx tenured 18mo retention long term older",
  },
  {
    id: "cx-refinance",
    label: "Refinance opportunities (CX)",
    hint: "Scored list ranked by retention risk",
    href: "/cx/refinance",
    keywords: "cx refinance refi opportunity risk score",
  },
  {
    id: "cx-reviews",
    label: "Review log (CX)",
    hint: "Every booked / emailed / skipped review",
    href: "/cx/reviews",
    keywords: "cx review log history audit booked",
  },
  {
    id: "cx-import",
    label: "Import commission XLSX (CX)",
    hint: "Refresh the back-book with the latest YBR statement",
    href: "/cx/import",
    keywords: "cx import xlsx commission ybr update upload",
  },
];
