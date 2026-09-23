# Deploying Mailflow

Written after the first production deploy, which took far longer than it
should have. Most of what follows is not difficult; it is just invisible
until you have hit it once.

## The Vercel project

**One project, one repo.** `mankin-mailflow` builds
`Mankinfinance/mankin-mailflow`. Nothing else should.

There were briefly three Vercel projects building the *LoanFlow* repo,
one of them named `mailflow`, and the resulting URLs
(`mailflow-tau-ten.vercel.app` and similar) served LoanFlow while
appearing to be Mailflow. Hours went into "why does Mailflow show
LoanFlow". If a deployment shows the wrong product, check which
repository the project is building before changing anything else: the
commit hash on the deployment tells you immediately, since the two repos
share no history.

### Framework Preset must be Next.js

This one costs a whole afternoon if you miss it.

With the Framework Preset set to **Other**, Vercel runs a build, reports
**Ready**, and then returns `404 NOT_FOUND` for every URL including `/`.
It never compiles the app: routing on Vercel comes from a manifest
generated at build time, and the preset is what decides whether that
manifest is generated at all. A request 404s at the edge before any file
lookup happens, so there are no runtime logs to look at either.

The signature is a **Ready deployment, a 404 on every path, and a build
that finished in well under a minute**. A real build of this app takes
two to four minutes and prints `Detected Next.js version: <version>`
followed by a route table. If the log has neither, the preset is wrong.

- Framework Preset: **Next.js**
- Root Directory: `./` or empty (both mean the repo root — the app is at
  the root here, unlike LoanFlow, whose app lives in `web/`)
- Build, Output, Install and Development commands: **no overrides**

After changing the preset, redeploy with **"Use existing Build Cache"
unchecked**. The cached output came from the broken build.

## Environment variables

### Signing in

| Key | Type | Value |
|---|---|---|
| `AUTH_SECRET` | Secret | `openssl rand -base64 32` |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Config | The **Application (client) ID** of the Entra app |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Secret | A client secret **Value** from that app |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | Config | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `NEXT_PUBLIC_APP_URL` | Config | `https://mankin-mailflow.vercel.app` |

`AUTH_MICROSOFT_ENTRA_ID_ID` is **not** the tenant ID, despite the name.
It is the client id of the sign-in app registration. The tenant id
appears only inside the issuer URL, and never as a variable of its own.

Mark as **Config**, not Secret, anything that is not actually secret —
the client id, the issuer, the app URL. A Vercel Secret is write-only:
once saved it can never be read back. LoanFlow marked its client id as a
Secret, which is why setting Mailflow up meant a trip to Azure to
recover a value that was sitting in Vercel all along. Only the client
secret and `AUTH_SECRET` need to be write-only.

A `NEXT_PUBLIC_` variable cannot be a Secret in any meaningful sense —
the prefix compiles it into the browser bundle. Vercel warns about this.

### Sending campaigns

Sign-in and sending use **two different app registrations**. The sender
(`lib/clients/outlook-mime.ts`) acquires an app-only Graph token:

| Key | Value |
|---|---|
| `MS_GRAPH_TENANT_ID` | The tenant id |
| `MS_GRAPH_CLIENT_ID` | Client id of the Graph app registration |
| `MS_GRAPH_CLIENT_SECRET` | A client secret from that app |
| `MOCK_OUTLOOK_SEND` | `false` |

Without these, everything else works and campaigns fail at send time.

App-only `Mail.Send` permits sending as **any mailbox in the tenant**
unless restricted by an application access policy. Scope it to the
sending mailbox. That is the difference between "this app can email as
the marketing account" and "this app can email as anyone in the firm".

### Storage

`DATABASE_URL` is optional. Without it the repos fall back to in-memory
storage: the app runs, and every campaign, contact and tag resets on
each redeploy. Fine for a look around, not for real sends.

### The assistant

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Switches the "Ask Mailflow" assistant on. Without it the panel says so. |
| `MAILFLOW_ASSISTANT_MODEL` | Optional. Defaults to `claude-sonnet-5`; set `claude-opus-5-5` for the most capable model, at more cost and latency. |
| `MOCK_CHAT` | `true` forces the assistant off, for a demo. |

One variable switches it on. The older convention elsewhere in the
code — requiring `MOCK_CHAT=false` as well as a key — is not used here,
for the same reason `DATABASE_URL` no longer needs `MOCK_DB=false`: two
variables to switch on one thing is a trap.

What it can do is fixed by code, not by its instructions: its tools
only read, and only aggregates — counts, rates, campaign and sequence
names, link URLs. No client's name or email address is sent to
Anthropic. Adding a per-client lookup would mean sending client
personal information to an overseas provider, which is the firm's
decision to make under the Privacy Act (APP 8), not a default.

Conversations live in the browser tab and are sent with each question;
nothing a broker types is stored. The audit log records that a
question was asked, which lookups ran and how long it took — not the
question.

## Which repo owns the migrations

**Mailflow runs them. LoanFlow must not.**

Both repos define the same tables, which sounds like a conflict and is
not one, because Mailflow's migration history is a strict superset of
LoanFlow's:

- `0000` through `0011` are **byte-identical in both repos** — Mailflow
  was forked from LoanFlow and inherited them unchanged.
- `0012` onward exists only in Mailflow: campaigns, automations, forms,
  landing pages, templates, tags, segments, settings, media, surveys,
  webhooks.
- LoanFlow stops at `0011` and needs nothing beyond it.

Drizzle records what it has applied in `__drizzle_migrations`. It stores
a hash of each file, but — contrary to what an earlier version of this
page said — it does not decide by hash. `pg-core`'s `dialect.migrate`
reads the single most recently applied row and replays every migration
whose folder timestamp is **newer than that one**, all inside one
transaction.

Pointing Mailflow at the database LoanFlow already migrated is still
safe, for a slightly different reason than the hash story implied: the
newest row will be `0011`, Mailflow's `0000`-`0011` carry the same
timestamps and are therefore not newer, and `0012` onward is. So it
applies exactly the missing ones. Running it the other way round does
nothing, since none of LoanFlow's are newer than what is already there.

### Sharing it is safe, and also not optional

Mailflow reads `settlements` — the back-book from the commission file —
out of Postgres, via `lib/settlements-store.ts`. Point it at a database
of its own and it has no contacts at all: no audience to resolve, no
anniversary to trigger on, no lender for a condition to test. It is the
loan book that makes this worth running instead of Mailchimp, so it has
to be the same database.

That is safe because Mailflow's migrations only ever add. Every `ALTER`
from `0012` onward targets a table Mailflow created itself —
`campaigns`, `campaign_recipients`, `form_submissions` — and every one
is an `ADD COLUMN`. Nothing LoanFlow owns is touched, nothing is
dropped, no type changes. Worth re-checking with a grep over
`drizzle/00[12]*.sql` before any future migration runs against
production, rather than trusting this paragraph.

### The thing that would break this

If LoanFlow ever adds a migration of its own and runs it, the failure is
worse than a collision and much quieter than one.

Because the check is "newer than the latest applied row", a single
LoanFlow migration applied today stamps the tracking table with today's
timestamp. Any Mailflow migration generated *before* that moment but
not yet applied is now older than the newest row — so Mailflow's
migrator skips it, reports success, and the table it was supposed to
create never exists. Nothing errors. The first sign is a query failing
against a table nobody noticed was missing.

A hash-based migrator would have double-applied and thrown a loud
"already exists". This one goes quiet instead, which is why the rule
matters more than it looked.

So, once they share a database: **schema changes go in Mailflow**. If
LoanFlow genuinely needs a new table, add it to Mailflow's schema and
let Mailflow migrate it, or split the databases first.

### Connecting it

1. Add `DATABASE_URL` in Vercel (Secret) for the Mailflow project.
2. Leave `MOCK_DB` unset. The repos use Postgres whenever a
   `DATABASE_URL` is present; `MOCK_DB=true` force-mocks even when one
   is, which is a testing lever rather than a production setting.
3. Redeploy. Environment variables are read by the running function,
   so a build made before the variable existed will not see it — the
   variable alone changes nothing until something redeploys.
4. Open `/marketing/settings/database` and press **Set up the tables**.

Step 4 is the same work `pnpm db:migrate` does, from a button, because
the person who needs to do it is a mortgage broker rather than a
release engineer. It applies the files in `drizzle/`, in order,
skipping those already recorded, and running it twice does nothing the
second time.

Until it runs, the app still starts: a query against a table that does
not exist yet is caught and falls back to empty rather than erroring
(see `isMissingRelation` in `lib/db/repos.ts`). That is a safety net
for a half-migrated database, not a substitute for migrating.

### `/marketing/settings/database`

A fixed URL rather than a panel to hunt for, because when something is
wrong the most useful question is which build am I even looking at.
The page reports:

- the commit this deployment was built from, and the Vercel environment
- whether `DATABASE_URL` is set, and whether `MOCK_DB=true` is
  overriding it
- how many migration files this build shipped — a zero here means the
  `drizzle/` folder was not traced into the function, and a migration
  run would report success having applied nothing
- whether the database can actually be reached, with the connection
  error when it cannot
- which of the schema's tables exist and which are missing

If that URL 404s, the deployment predates the page. That is the answer
to "I can't find the button": nothing is misconfigured, the build is
just older than the feature. Redeploy.

## Sign in from the production domain, not a deployment URL

Every Vercel deployment gets its own hostname —
`mankin-mailflow-<hash>-mankin-finance.vercel.app` — and the hash
changes on every deploy. Clicking through from the Vercel dashboard
lands you on one of those.

Auth.js builds its callback URL from the host the request arrived on,
so signing in from a deployment URL asks Microsoft to redirect back to
that hostname, which is not registered in Entra and could never be:
there is a new one every deploy. The result is `AADSTS50011`, which
reads as "the redirect URI is wrong" when the redirect URI is fine and
the *starting* URL was wrong.

The tell is a hash in the hostname. `mankin-mailflow.vercel.app` with
nothing between the name and `.vercel.app` is the one that works.

To remove the trap rather than remember it, set `AUTH_URL` to
`https://mankin-mailflow.vercel.app` in Vercel. Auth.js then always
builds callbacks against that host whatever the request arrived on, so
signing in from a deployment URL redirects to production and succeeds.

## Azure

The sign-in app registration needs Mailflow's callback in its redirect
URIs, alongside whatever is already there:

```
https://mankin-mailflow.vercel.app/api/auth/callback/microsoft-entra-id
```

A client secret's **Value** is shown once, at creation, and is
unrecoverable afterwards — from Azure or from Vercel. To "retrieve" one,
create a new secret. An app registration holds several valid secrets at
once, so adding one does not disturb whatever is already using the app.

On the New client secret screen, **Value** is the secret and **Secret
ID** is not. Copy the Value before leaving the page.

## Crons

The project is on Vercel Pro, so the schedules in `vercel.json` run at
the cadence the code was written for:

| Job | Every | Why that often |
|---|---|---|
| `/api/cron/campaigns` | 5 minutes | A scheduled send goes out when it was scheduled |
| `/api/cron/webhooks` | 5 minutes | An unsubscribe reaches other systems within minutes |
| `/api/cron/automations` | 15 minutes | Sequence steps are measured in days; transitions are not |
| `/api/cron/bounces` | hour | Non-delivery reports take minutes to hours to arrive |

**Every one of them refuses to run without `CRON_SECRET`.** The routes
fail closed, because `/api/cron/` is outside the sign-in proxy and the
secret is the only gate. Vercel sends it on its own invocations as
`Authorization: Bearer <value>`. Without it nothing scheduled ever
happens: no scheduled campaign, no sequence step, no bounce, no
webhook — and nothing on screen says so except the Setup panel and the
assistant's setup check.

Hobby would reject these schedules at deploy time; they need Pro.

## When it does not work

- **404 on every path, Ready, fast build** → Framework Preset is not Next.js
- **Wrong product entirely** → the project is building the other repo; check the commit hash
- **`AADSTS50011`** → redirect URI missing or mistyped in the Entra app — or, more often, you started from a deployment URL rather than the production domain. Check the hostname in the error for a hash.
- **`AADSTS7000215`** → wrong client secret, usually the Secret ID copied instead of the Value
- **500 or an application error** → an env var is missing; check Runtime Logs
- **A warning that `middleware.ts` cannot be found** → a false positive. Next 16 renamed middleware to `proxy.ts`; ignore it.

## Salestrekker, LoanFlow and deal notes

There is **no live connection to Salestrekker** in this codebase. The
"real" Salestrekker client throws "not yet implemented"; the one in use
reads the deals table both products share — the pipeline LoanFlow
imports from Salestrekker — and keeps any write it cannot store in
memory. Setting `MOCK_SALESTREKKER=false` would select the unwritten
client and break every page that lists deals, so leave it unset.

What that means in practice:

- **The live pipeline** is LoanFlow's imported deals.
- **Forms that create a deal** add it to that table, so it appears in
  LoanFlow's pipeline. It does not appear in Salestrekker.
- **Deal notes.** Campaign activity is written to `deal_notes`, which
  LoanFlow's deal drawer lists under "Notes", headed "Mailflow · date":

| Event | The note |
|---|---|
| `automation.entered` | The milestone that fired, in the canvas's words |
| `automation.completed` | Which ending, in the sequence author's own note |
| `contact.clicked` | The campaign or sequence, and the link |
| `contact.unsubscribed` | That they opted out; loan correspondence unaffected |
| `contact.bounced` | The mail server's own diagnostic; confirm the address |
| `survey.responded` | The NPS score and their comment |

The first version of this wrote only through the Salestrekker client's
addNote, which logs to the console and stores nothing, while this doc
said the notes reached Salestrekker. They reached nowhere. addNote is
still called after the note is saved, as LoanFlow does, so a real
client would receive them without a change here.

Only contacts from the pipeline get notes — `sourceKind` of `deals`.
The settled back-book has no open deal. Survey answers find their deal
through the link, which carries it inside the signature; links sent
before that existed produce no note. Notes are written after the
response is sent (Next's `after`), and `SALESTREKKER_NOTES=false`
turns them off.

**Demo deals.** When the imported-deals table is empty, the client
used to fall back to sixteen invented deals — with real-looking
addresses at gmail.com, outlook.com and so on. In production those
would have joined the live-pipeline audience and been emailed. On a
production deployment (`VERCEL_ENV=production`) the fallback is now
empty; it still fills in locally and on previews.

## Engagement in automation emails

Automation emails' tracking links name the exact send
(`auto:<automationId>:<sendId>`). Opens, clicks and unsubscribes are
recorded on that send, which is what every "if they opened / clicked"
step judges.

Until this was fixed, the links carried `auto:<automationId>` and the
tracking routes looked it up as a campaign recipient, found nothing,
and dropped the engagement — so every engagement condition answered
"no" once its window closed, and a client who had clicked still got
the follow-up meant for people who had not. Links in any email sent
before the fix still resolve, to the contact's most recent send in
that sequence.

A failure is logged and swallowed. Losing an unsubscribe because the
CRM was down would be much the worse trade.

Set `SALESTREKKER_NOTES=false` to turn it off. It is on by default,
because the alternative — a feature nobody can tell is switched off —
is indistinguishable from it being broken.
