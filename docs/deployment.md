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

Vercel rejects sub-daily cron schedules **at deploy time** on Hobby — it
fails the build rather than quietly skipping runs. `vercel.json` is on
daily schedules for that reason. Hourly sending needs Pro.

That cost is worst for `/api/cron/webhooks`, which drains queued
webhook deliveries. On a daily schedule an unsubscribe can take a day
to reach a receiver, which is slow for something another system is
waiting on. It wants to run every few minutes, and is the strongest
single argument for Pro.

## When it does not work

- **404 on every path, Ready, fast build** → Framework Preset is not Next.js
- **Wrong product entirely** → the project is building the other repo; check the commit hash
- **`AADSTS50011`** → redirect URI missing or mistyped in the Entra app — or, more often, you started from a deployment URL rather than the production domain. Check the hostname in the error for a hash.
- **`AADSTS7000215`** → wrong client secret, usually the Secret ID copied instead of the Value
- **500 or an application error** → an env var is missing; check Runtime Logs
- **A warning that `middleware.ts` cannot be found** → a false positive. Next 16 renamed middleware to `proxy.ts`; ignore it.

## Salestrekker

Two directions, and they work differently.

**Out of Salestrekker into Mailflow**: the existing API client. Deals
and settlements are read from it; `SALESTREKKER_API_KEY` is the only
setting.

**Out of Mailflow into Salestrekker**: notes on the deal, not HTTP.
Salestrekker has no inbound webhook URL to POST an envelope at, so the
"webhook" is `addNote` through the same client, written when a
campaign event concerns somebody with an open deal:

| Event | What lands on the file |
|---|---|
| `contact.clicked` | The campaign and the link they clicked |
| `contact.unsubscribed` | That they opted out, and that loan correspondence is unaffected |
| `contact.bounced` | The mail server's own diagnostic, and to confirm the address |
| `survey.responded` | The NPS score and their comment |

Not `form.submitted`: a form with a Salestrekker destination already
creates the deal through the same client, so a note would annotate a
deal that exists because of it. Not `campaign.sent` or
`campaign.failed`: those are about a send, not a person, so there is
no file they belong on.

Only recipients whose contact came from a deal get a note. The settled
back-book has no open deal to write on, and a note cannot invent one.

A failure is logged and swallowed. Losing an unsubscribe because the
CRM was down would be much the worse trade.

Set `SALESTREKKER_NOTES=false` to turn it off. It is on by default,
because the alternative — a feature nobody can tell is switched off —
is indistinguishable from it being broken.
