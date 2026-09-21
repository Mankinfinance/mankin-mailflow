# Mailflow

Email marketing for Mankin Finance — campaigns, automations, forms and
landing pages, run off the loan book rather than off a list somebody
maintains by hand.

Extracted from [`mankin-followup`](https://github.com/Mankinfinance/mankin-followup),
where it lived as the `/marketing` module inside LoanFlow.

---

## The thing to understand first

**Mailflow and LoanFlow share one database.** That is not an accident to
be tidied up later — it is the whole reason the product is worth having.

Mailflow's audience is not a mailing list. It is the settled back-book
and the live pipeline, read directly:

- Automations trigger on facts only the loan book knows — *a loan passes
  its 12-month settlement anniversary*, *a deal has sat at Pre-Approval
  Only for 60 days*.
- Merge fields resolve to the real lender, balance, settlement date and
  owning broker.
- Forms and landing pages create deals **in the pipeline**, not leads in
  a silo.
- The do-not-market register is honoured across both products.

Cut it off from that data and what remains is a worse MailerLite that
someone has to feed by hand. So:

| Table | Owner | Mailflow's access |
|---|---|---|
| `settlements`, `deals`, `team_*` | LoanFlow | **read only** |
| `campaigns`, `campaign_recipients`, `campaign_link_clicks` | Mailflow | read/write |
| `automations`, `automation_runs`, `automation_sends` | Mailflow | read/write |
| `forms`, `form_submissions`, `landing_pages` | Mailflow | read/write |
| `email_suppressions`, `contact_tags`, `audience_segments` | Mailflow | read/write |
| `email_templates`, `mailflow_settings` | Mailflow | read/write |

**Migrations `0012`–`0022` in `drizzle/` are Mailflow's.** Everything
below `0012` belongs to LoanFlow and is carried here only so the schema
file type-checks. Run migrations from **one** repo — whichever you pick,
be consistent, because both point at the same Postgres and two
`drizzle-kit migrate` histories against one database will fight.

## Running it

```bash
pnpm install
cp .env.example .env.local     # defaults run fully mocked
pnpm dev
```

Mocked mode needs no credentials and sends nothing. `/` redirects to
`/marketing`.

## Before the first real send

1. `DATABASE_URL` pointed at the same Supabase project as LoanFlow, and
   `MOCK_DB=false`.
2. `CRON_SECRET` set. Every cron route **fails closed** without it, so
   nothing runs at all — that is deliberate: `/api/cron/campaigns` sends
   real email.
3. `NEXT_PUBLIC_APP_URL` set to the real production URL. Every tracking,
   unsubscribe, form and landing-page link is built from it, and a wrong
   value is not recoverable after a send — the links are already in
   people's inboxes.
4. SPF, DKIM and DMARC passing for the sending domain. See
   [`docs/deliverability.md`](docs/deliverability.md).
5. `MOCK_OUTLOOK_SEND` — **unset means live.** The check is
   `=== "true"`. Set it explicitly to `true` until you have sent
   yourself a test and clicked the unsubscribe link.

Full sequence in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) § 8.

## Vercel

Its own project, separate from LoanFlow's. Crons are daily here because
the Hobby plan refuses sub-daily schedules **at deploy time** — it fails
the build rather than degrading quietly. On Pro, restore the hourly
schedule in `vercel.json`:

```jsonc
{ "path": "/api/cron/campaigns",   "schedule": "0 * * * *" },
{ "path": "/api/cron/automations", "schedule": "30 * * * *" }
```

Until then a campaign scheduled for 2pm goes out the next morning and a
sequence advances one step per day.

## Layout

```
app/(mailflow)/marketing/   Dashboard, campaigns, automations, forms,
                            landing pages, subscribers, templates,
                            settings, do-not-market register
app/e/                      Open pixel, click redirect, unsubscribe
app/f/, app/p/              Public hosted forms and landing pages
app/api/cron/               campaigns · automations · bounces
lib/campaigns/              Audience, merge, tracking, send, A/B, bounces
lib/automations/            Trigger evaluation, flow engine, runner
lib/forms/, lib/sites/      Enquiry forms and page blocks
lib/mailflow/               Dashboard figures, sending health, settings
lib/db/                     Drizzle schema + repositories (mock-first)
```

`lib/clients/`, `lib/auth/`, `lib/team.ts` and `lib/settlements-store.ts`
are shared with LoanFlow and were copied, not rewritten. **They will
drift.** When you change one in either repo, change it in both — or move
them to a package both consume, which is the real fix if this split
outlives the year.

## Where this came from

[`docs/history-from-loanflow.md`](docs/history-from-loanflow.md) carries
the twenty-six commit messages from before the extraction, newest last.
The code arrived here as one commit; that file is where the reasoning
behind it lives — why the crons fail closed, why using a template
copies it rather than referencing it, why the click redirect verifies
before it forwards.

## Tests

```bash
pnpm test        # 400 tests
pnpm typecheck
pnpm lint
```

The ones worth knowing about: `lib/campaigns/ab-test.test.ts` (when a
subject-line test may and may not be called), `lib/campaigns/audience.test.ts`
(who a filter actually reaches), `lib/clients/outlook-mime.test.ts`
(header injection), and `lib/mailflow/settings.test.ts` (the
stored-over-env precedence).
