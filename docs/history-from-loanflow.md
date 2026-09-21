# How Mailflow was built

Mailflow began as the `/marketing` module inside
[`mankin-followup`](https://github.com/Mankinfinance/mankin-followup)
and was extracted into this repository as a single commit. That commit
carries the code but not the twenty-six commits behind it, and those
commit messages are the only record of *why* a good deal of this code
is shaped the way it is — why the crons fail closed, why a template is
copied rather than referenced, why the click redirect verifies before
it forwards.

They are reproduced below, newest first, exactly as written. The SHAs
refer to the branch `claude/email-marketing-tool-bfyl09` in
`mankin-followup`, which no longer exists — they are here for
provenance, not for checking out.

---

## feat(campaigns): data model, audience resolver and email renderer

*76b13fc · 24 August 2026*

Groundwork for the email marketing tool: a broker writes one body, a
saved audience filter decides who it reaches, and every recipient gets
their own merged copy.

Three new tables (drizzle/0012, RLS enabled like every other table so
they stay off the Supabase Data API):
 - campaigns: the written send + its audience filter as JSONB
 - campaign_recipients: one row per person, the send queue and the
   evidence trail for what actually went out
 - email_suppressions: the do-not-market register

lib/campaigns/audience.ts resolves a filter into recipients across the
YBR back-book and the live pipeline. It never invents an address (a
commission row with no email is dropped rather than name-matched against
the deal list) and never mails one twice — a customer in both datasets
is mailed once, from the richer back-book record. It also respects the
existing per-deal exclude-from-updates switch.

lib/campaigns/merge.ts renders one recipient's copy: merge fields,
[label](url) links (the one markup campaigns need that one-to-one
emails don't), optional click wrapping and open pixel, the broker's
signature — campaigns send unattended so nobody is in Outlook to insert
one — and the unsubscribe footer. The footer is appended by the
renderer, not left to whoever writes the body, because a commercial
electronic message needs a working unsubscribe under the Spam Act 2003.
Set CAMPAIGN_POSTAL_ADDRESS to add a postal line.

22 unit tests over both pure modules.


---

## feat(campaigns): signed tracking links, unsubscribe flow and batched sender

*396764d · 24 August 2026*

Completes the sending half of the campaign tool.

Tracking (lib/campaigns/tracking.ts): unsubscribe, open and click URLs
are signed JWTs on the same AUTH_SECRET as portal tokens, with their own
audience claim so neither kind can be replayed at the other's endpoint.
A recipient can't edit someone else's address into an unsubscribe link.
Two-year TTL — the right to opt out doesn't expire, so neither does the
link.

Three public endpoints under /e/ (added to the auth.config public list;
an unsubscribe link that bounces to /login is a broken unsubscribe):
 - /e/u/[token]: confirm-then-act landing page. It acts on the button,
   not on page load, because scanners and preview bots fetch every URL
   in an email and would otherwise opt people out silently.
 - /e/o/[token]: open pixel. Returns the GIF whatever happens behind it
   — tracking is ours to lose, not the customer's to see.
 - /e/c/[token]: click redirect. Records, then forwards; refuses any
   destination that isn't ordinary http(s), so a hand-edited query
   string can't turn it into an open redirect.

Sender (lib/campaigns/send.ts) drains the queue in batches of 60 through
app-only Graph — the cron has no signed-in broker — but sends as the
owning broker's mailbox so replies land with the person who has the
relationship. Serial and capped per run to stay under Exchange Online's
per-mailbox rate; the hourly cron comes back for the next slice. The
suppression list is re-checked at send time, not trusted from resolve
time, because someone can unsubscribe while the queue is still draining.

13 more tests covering token forgery, purpose confusion, redirect
safety, suppression-after-resolve, per-recipient failure isolation and
batch resumption.


---

## feat(campaigns): campaign editor, results view and do-not-market list

*ddc7aee · 24 August 2026*

The broker-facing half of the email marketing tool, admin-gated
throughout — a campaign reaches the whole back-book in one click, which
is a business-wide act rather than a broker's own customer comms.

/dashboard/campaigns lists every send with sent/opened/clicked/opted-out
at a glance. /dashboard/campaigns/[id] is the editor while a campaign is
a draft or paused, and becomes the results view once it is sending or
sent — the body a customer has already received is not something to
edit.

The editor keeps the audience count live as the filter changes, because
"this reaches 412 people" is the number that decides whether a segment
is right; leaving it behind a separate preview step means it gets
skipped. It samples eight real recipients, and explains its own
subtraction: who is on the do-not-market list, who has no email on file,
who was already counted from the other source. Unknown merge fields are
flagged as you type and block the send outright — a typo'd {{firstname}}
reaching 400 inboxes as a blank is the failure mode worth engineering
against. "Send me a test" mails the broker a copy merged against a real
recipient's values rather than placeholders, for the same reason.

Sending resolves the audience into a fixed recipient list. A campaign
reviewed on Monday reaches the people it was reviewed against, not
whoever matches on Thursday. The first batch goes immediately so the
broker sees movement; the rest drains hourly. Pause leaves the queue
intact so a send going wrong can be halted and picked back up.

/dashboard/campaigns/suppressions is the opt-out register: unsubscribe
clicks land automatically, phone and reply opt-outs get added by hand,
and removing someone is a confirm-and-audit action because it means
marketing to a person who once asked us not to.


---

## fix(campaigns): send-rate budgets, restart guard, and the feature doc

*f35997f · 24 August 2026*

Three things found reviewing the diff back:

Timeouts. The cron is capped at maxDuration 300s but had no ceiling on
how much work it would attempt — a dozen due campaigns would each try a
full 60-message batch and run the invocation past its budget. Adds a
shared per-run budget of 120 sends across all campaigns; whatever it
doesn't cover stays pending for the next run. The broker's own "Send
campaign" click now dispatches a much smaller first batch, since a
server action has a far tighter budget than the cron and its only job
there is to show the campaign moving.

Restarting a part-sent campaign. Pausing a campaign made it editable
again, and hitting Send would have resolved a fresh recipient list —
replacing the old one, losing the record of who had already received it,
and mailing those people a second copy. Starting is now refused once
anyone has been mailed, pointing at Resume or a fresh campaign instead.

Sent Items. A 500-person blast would have dropped 500 near-identical
messages into the sending broker's Sent Items and buried their real
correspondence. campaign_recipients is the record of who was mailed and
when, and it is a better one. Test sends still save — a broker checking
their own copy expects to find it.

Also adds docs/campaigns.md: how a campaign flows, the audience rules,
the body markup and merge fields, the Spam Act posture, configuration,
send rate, and what the tool deliberately doesn't do (bounce handling,
A/B tests, drip sequences).


---

## feat(mailflow): implement the design handoff for campaigns, register and unsubscribe

*dcc52f4 · 25 August 2026*

Rebuilds the marketing surface against design_handoff_mailflow. The
module gets its own shell at /marketing: a 200px nav with the ten
destinations the handoff specifies, and a 52px top bar whose left side
becomes the record context when you are inside a campaign. LoanFlow's
sidebar now links across rather than nesting a "Campaigns" page among
the pipeline views — ten marketing destinations have nothing to do with
a deal's stages.

Tokens the handoff adds sit in globals.css beside the existing ones:
the softer table hairline, the five status fill triplets, the muted
numerals a calm zero needs, and the validated chart series colours.
Those four are hex rather than oklch on purpose — they were
colourblind-validated at those exact values and round-tripping them
through oklch would move them. Motion is two keyframes and nothing
else, both off under prefers-reduced-motion.

The audience builder is the part the handoff calls the priority, and it
is rebuilt as a sentence rather than a form: lead words on a fixed 74px
axis, italic connectors carrying the grammar, values as the only things
that look interactive. Clauses belonging to an unticked source go
dormant under a dimmed rule instead of unmounting, so the sentence keeps
its shape and nothing below it jumps while you edit. An unset bound
reads "no maximum" rather than sitting blank.

The reach rail shows its arithmetic — matched, minus suppressed, minus
no-email, minus already-counted — and the send button names the count,
so the last thing read before sending is how many people it reaches. Its
recounting state keeps the previous figure legible under a shimmer
rather than collapsing to a spinner.

An unknown merge field now blocks the send outright, with the banner
welded to the editor's bottom edge and a "Correct it" action that fixes
the typo by edit distance. {{firstname}} reaching 180 people as "Hi ,"
is the failure this is engineering against.

Two backend changes the design needed: campaign_link_clicks (drizzle
0013, RLS on like its siblings) so the report can say WHAT was clicked
rather than only that something was, and last_name / loan_status merge
fields, which the data already carried. The report's 72-hour curve is
derived from recipient timestamps at read time — both series count
people, so one axis carries both.

Deviations from the handoff, all deliberate: it invents an ACL number
and a street address, so the unsubscribe page prints the real credit
line from lib/email-signature.ts instead; and the merge-field chips
offer the twelve fields the sender can actually populate rather than the
handoff's list, since a chip that renders blank is the exact bug the
error state exists to catch.


---

## feat(mailflow): dashboard, with a held axis and honest zeroes

*606b800 · 25 August 2026*

Screen 1 of the handoff, against real data: last sent campaign with its
four rates, the contactable-audience block, the 30-day growth chart,
this month's engagement, and performance by month sent.

The zero-state treatment is the point. A brokerage adds contacts in
monthly batches and sends twice a month, so most days genuinely are zero
and the growth line genuinely is flat. Every zero is paired with the
reason it is expected ("none expected", "next import at month end") and
rendered in the muted numeral rather than full-strength ink, so nothing
here reads as broken or as needing action.

holdAxis is the fix for the chart this replaces. MailerLite's subscriber
graph auto-scales, which turns a two-contact unsubscribe into a cliff
and makes an ordinary month look like an incident. Holding a minimum
10-contact window means a two-contact dip renders as a two-contact dip;
a genuinely large movement still gets its own scale. The subhead says so
on the card, so the flatness reads as designed rather than as missing
data.

The contact series is reconstructed rather than recorded — the back-book
knows its size now, not its size on 3 August — by walking backwards from
today and adding each opt-out back as you pass its date. Exact for the
movement we cause, blind to imports, which is why the card says imports
arrive in batches rather than implying the line captures them.

The spam-complaint column renders "not measured", not "0.00%". Graph
gives us no feedback loop, so a zero there would be a claim we had
checked. The threshold chip and the 0.10% rule are wired and will light
up the moment a real rate exists.

12 tests over the derivations, including the two that matter: that a
flat series still spans a sensible window, and that an unmeasured
complaint rate never counts as at-risk.

Verified in the running app with Playwright: both blocked send states
(unknown merge field, empty audience), the "Correct it" fix, the gold
"Send to 13 people" ready state, and the audience sentence with its
dormant pipeline branch.


---

## feat(mailflow): subscribers list with loan context

*6f87025 · 25 August 2026*

Screen 2 of the handoff. Assembled from the same two datasets a campaign
draws on plus the register, so this page and an audience preview can
never disagree about who exists or who is contactable — the same
back-book-wins precedence, the same drop-if-no-email rule.

The loan-context panel is the reason this runs in-house rather than in
MailerLite: lender, settled date, balance at settlement and today,
owning broker, loan status. An external platform knows an address and a
tag. This knows the loan, which is what makes "who should I be talking
to" answerable without leaving the screen.

Activity is derived from the recipient rows rather than a second event
log — they already carry every timestamp we record, and a parallel store
of the same facts is a parallel store to keep in step. Dot colours
follow the chart series, so "clicked" is the same teal here as on a
report.

The date column is "client since", not "subscribed". Nobody here
subscribed: these are clients, and the lawful basis for marketing to
them under the Spam Act is the existing business relationship. A
"subscribed" column would imply a consent record we do not hold and
could not produce if asked for it.

Bulk "Do not market" writes the whole selection to the register in one
action, for the cohort that asks off after a call round.

9 tests over the assembly: dedupe across datasets, bounce distinguished
from opt-out, no-email records dropped, search across name and email,
and activity ignoring rows belonging to someone else.

Verified in the running app: list, filters, row selection and the
detail panel.


---

## feat(campaigns): bounce reconciliation from the sending mailbox

*7147e23 · 25 August 2026*

Closes the gap flagged when the sender was built. Graph's sendMail
reports no delivery outcome, so a dead address stayed on the list and
cost a send every time it matched a segment — and a back-book collected
over years has plenty. /api/cron/bounces reads the non-delivery reports
back out of the mailboxes campaigns were sent from, nightly at 5am AEST
once the batches have drained.

The safety property is the order of operations: the set of addresses we
actually sent to in the last 30 days is built BEFORE any mailbox is
read, and an address outside it is never suppressed whatever a bounce
body claims. Every NDR quotes the original message, so each one contains
the broker's own address, the support CC and often a postmaster contact.
Gating on the sent set is what stops a quoted footer removing the
support mailbox from the list. There is a test for exactly that.

Classification is conservative, because suppressing a live address costs
a client relationship while missing a bounce costs one wasted send:

 - Hard (5.x.x) suppresses immediately.
 - Soft (4.x.x) is counted; three before the address is given up on. One
   bad week should not cost a client their updates.
 - Over-quota is always soft, whether the server codes it 4.2.2 or
   5.2.2 — the person still exists.
 - Policy and throttling blocks (5.7.x) are soft, because they are about
   our sending reputation rather than the recipient. Treating them as
   hard would delete the audience one campaign at a time while the real
   problem sat at our end.
 - Anything unclassifiable is left alone rather than guessed at.

Reading mail needs Mail.Read on the same Entra app registration that
already holds Mail.Send. Without consent the run reports needsConsent
and changes nothing, rather than failing the cron.

A bug the tests caught before it shipped: the diagnostic-line fallback
matched /diagnostic/, which on a real Exchange report picks the section
heading "Diagnostic information for administrators:" — three lines above
the one carrying the status code — so every Exchange NDR parsed as
unclassifiable. The line is now chosen in descending order of how much
it actually tells us.

The Subscribers screen's "bounced" status now populates itself, and the
campaign report says a hard bounce will not be mailed again instead of
asking someone to add it by hand.

22 tests: 14 over the parser against real Exchange and Postfix report
shapes, 8 over the reconciliation.


---

## feat(automations): sequence engine, triggers and runner

*4ba2ab6 · 25 August 2026*

The backend for Screen 6. A campaign is one body sent once to a list a
broker chose; an automation is a rule that keeps running, where the book
decides who enters and when. That is the difference that makes it worth
building for a brokerage — nobody has to remember to send the annual
review.

Flow model: a flat list of nodes with explicit next / nextYes / nextNo
pointers rather than a nested tree. A tree reads better on paper but
makes "where is this contact up to" a path through nested arrays; flat
means a run's position is one node id, which is what makes the engine
testable and a stuck run diagnosable.

lib/automations/engine.ts is pure — it performs no sends and reads no
database, it just decides the one next thing to do. That is what lets a
five-day sequence be tested in milliseconds, including the branch that
would otherwise take five days of real time to observe.

Two decisions worth naming:

"Not opened" is only true once the window has closed. Deciding it the
moment we look would send the follow-up to someone who simply had not
got to their inbox yet — the difference between a sequence that feels
attentive and one that feels like a machine.

A contact enters a given automation once, ever, enforced by a unique
index on (automation, email). Re-entry would mean sending the same
annual review twice.

A bug the tests caught: nextRunAt was doing double duty as both "when to
look again" and "when the wait expires". The runner sets it to now on
every move, so the engine read every delay as already served and the
whole five-day sequence ran in a single pass. Runs now carry
nodeEnteredAt and delays are measured from arrival; there is a test
named for it.

Suppression is checked at entry and again before every step, because
someone can unsubscribe from step one while step two is queued. A failed
send is a dropped step, not a stuck contact — the run moves on.

42 tests: 17 over the engine, 16 over trigger eligibility, 8 over the
runner end to end (enrol once, hold the delay, both branches, opt-out
mid-sequence, drafts enrol nobody).


---

## feat(automations): template gallery, canvas and activation

*f12b90d · 25 August 2026*

Completes Screen 6. The list sits above a categorised gallery rather
than behind a "new" button, because a brokerage will have three or four
sequences ever — the useful default is "here is what else you could turn
on", not a tidy empty page.

Seven templates across four categories, each wired to a trigger the loan
book can already answer: three-month settling-in, twelve-month annual
review, two-year repricing, pre-approval going cold, two weeks lodged
with no news, post-settlement welcome, and a win-back for a loan that
refinanced away. Nothing here is an abandoned cart or a birthday,
because a broker has neither — but they do have eight hundred loans with
anniversaries nobody is watching. Each card states its trigger and its
rough monthly volume, so the decision to turn one on is made with the
consequence visible.

The canvas draws the sequence with per-node counts on each card, because
"how many people are sitting here right now" is the question the screen
gets opened to answer; a flow diagram without those numbers is
documentation, not a dashboard. Branch arms land on their columns
rather than near them.

Activation validates first and surfaces the problems in full — they are
sentences like "this send has no subject yet", and burying them behind a
generic failure would mean toggling a switch that silently does nothing.
Pausing stops new people entering but lets anyone partway through
finish: cutting them off would leave someone who was told "I will follow
up" never followed up.

Verified in the running app: gallery → use template → canvas → turn on.


---

## feat(forms): enquiry forms that write into the loan pipeline

*8d28cdb · 25 August 2026*

Screen 7. Three types — pop-up, embedded, promotion bar — each hosted at
/f/[id] and embeddable with an iframe snippet the editor hands you.

The principle the module is built around: a submission creates a deal,
not a list entry. A form that only grows a mailing list is a form nobody
follows up, and an enquiry outside the pipeline is one the daily queue
never surfaces. Enquiries arrive numbered MF-NNNN in the same shape as a
referral lead, so a website enquiry and a partner referral look
identical to whoever picks them up.

The reliability property, since a public form is the one place the
person on the other end cannot be asked to try again: the submission row
is written first and the deal second. If deal creation throws, the
enquiry survives carrying the error and shows as "needs picking up by
hand" — and the customer is still told it worked, because for them it
did. There is a test for exactly that.

Seven templates across four categories, each asking for as little as it
can. No spin-to-win and no mystery discount: a mortgage is not an
impulse purchase, and a gimmick on a credit licensee's website reads as
exactly that. Conversion is null rather than 0% until someone has
actually loaded the form — a form nobody has seen has not failed to
convert.

The editor previews with the real public component rather than a
mock-up, so what a broker approves is literally what the website
renders. Saving refuses a form that asks for neither an email nor a
phone, because that produces enquiries nobody can answer.

Also fixes a genuine trap found while verifying this in the browser: the
repo bundle was cached in a module-level variable, and Next gives route
handlers a different module instance from pages — so a form created
through a page was invisible to /api/forms/[id]/submit, which 404'd on a
record that plainly existed. Real Postgres hides it because both
instances read the same database, so it only bites in mock mode, which
is where a developer is least expecting it. The bundle is now pinned to
globalThis, which also survives hot-reload.

15 tests over validation, conversion maths, template integrity and the
submission path. Verified in the browser end to end: template → publish
→ public submission → enquiry record → deal in the pipeline.


---

## feat(mailflow): landing pages, plus automation and form blocks on the dashboard

*518957f · 25 August 2026*

Completes the module. Landing pages live at /p/<slug>, assembled from a
fixed block set — headline, paragraph, bullets, numbered steps, client
quote, enquiry form.

Deliberately not a general page builder. A brokerage needs a handful of
pages that each do one job, and a freeform canvas would mean every page
needs design decisions nobody has time to make. A fixed block set means
any page a broker assembles is already on brand and already responsive.

The form block embeds a form from the Forms module rather than defining
its own fields, so a landing page inherits the same pipeline
destination, consent line and conversion tracking. Only live forms can
be embedded: pausing a form should stop it collecting everywhere it
appears, not just on its own hosted page.

Publishing is validated — a page with no enquiry form, an enquiry block
with no form chosen, or no page title cannot go live. A published page
with a form-shaped hole in it is worse than an unpublished one. A draft
404s rather than rendering, so an unfinished page is not reachable by
anyone who guesses the slug.

Slugs get -2, -3 appended rather than being refused: two pages called
"Refinance health check" a year apart is normal, and making a broker
invent a unique name is worse than a numbered address. Reserved paths
are protected so a page cannot shadow the app's own routes.

Views are counted from a client beacon rather than the server render:
with force-dynamic every render would count, including bot fetches and
the broker's own preview refreshes, which would quietly halve every
conversion rate on the page.

The dashboard also gains blocks for Automations and Forms. Form
conversion is weighted by views rather than averaging per-form rates —
otherwise a form seen twice and submitted once swamps one seen four
hundred times.

21 tests over slug rules, page validation, template integrity and the
dashboard aggregation. Verified in the browser end to end: template →
choose form → publish → visit /p/refinance-health-check → submit →
1 visit, 1 enquiry, 100% on the list, and Daniel Okafor in the pipeline.

Docs updated: docs/campaigns.md now covers all five surfaces and the
three crons.


---

## feat(mailflow): sending health from the signals we actually own

*6e01bfe · 25 August 2026*

Adds a 30-day reputation panel to the dashboard: opt-out rate as a share
of delivered mail, hard-bounce rate as a share of attempted mail, each
banded healthy / worth watching / needs attention against the usual
industry lines.

Both stay quiet below 50 sends. Two opt-outs from ten sends is 20%,
which would scream — and a false alarm there trains people to ignore the
real one. There is a test named for that.

Bounces are counted off the do-not-market register rather than the
failed recipient rows, because a bounce arrives after the send —
sometimes days later — and the register is where reconciliation writes
it.

This exists because the number everyone reaches for first, the
recipient-side complaint rate, is not obtainable on this setup, and the
dashboard should not imply otherwise:

 - Microsoft SNDS and the Outlook.com JMRP feedback loop are keyed to
   the sending IP. Mail leaves through Exchange Online's shared outbound
   pool, which the firm does not own and cannot register. Those tools
   are for organisations running their own mail servers.
 - Google Postmaster Tools reports per domain, so it does apply — but it
   suppresses low-volume days, and a brokerage sending a few hundred to
   Gmail twice a month sits under that line nearly always.

So the complaint column keeps reading "not measured", now pointing at
the panel above it, and the reasoning is written down in
docs/campaigns.md along with what wiring Postmaster Tools would take if
volume ever justifies it.

9 tests over the banding, the small-sample floor, window boundaries and
the register-sourced bounce count.


---

## feat(mailflow): send as MIME so bulk mail carries the headers Gmail requires

*498e265 · 25 August 2026*

Hardens deliverability. The application half is done here; the DNS half
is written up in docs/deliverability.md and needs someone with the
domain and the Microsoft 365 admin centre.

The unlock is sending raw MIME. Graph's ordinary JSON send refuses any
internet message header whose name does not start with "x-", which rules
out List-Unsubscribe entirely — verified against Microsoft's own answer
threads, not assumed. Posting a base64 RFC 822 message to the same
endpoint sidesteps it, so every bulk send now carries:

 - List-Unsubscribe, https one-click endpoint first, mailto second
 - List-Unsubscribe-Post: List-Unsubscribe=One-Click, which Gmail and
   Yahoo have required of bulk senders since February 2024
 - Precedence: bulk and Auto-Submitted: auto-generated
 - a Message-ID on the sending domain

It also buys a genuine multipart/alternative with a real plain-text
part built from the same source as the HTML. HTML-only mail is one of
the oldest reliable spam signals, and we were sending HTML-only.

The one-click endpoint at /api/e/u/<token> acts immediately with no
confirmation, as RFC 8058 requires and providers check. The body link
stays at /e/u/<token> and still confirms first. Both are correct: a
scanner following a link must not opt anyone out, but a POST carrying
List-Unsubscribe=One-Click is a deliberate action a person just took.

Content is checked as the broker types — shouted subjects, piled-up
punctuation, the phrases filters weight, shortened links, link count,
bodies that are barely more than a link. Every issue names a fix rather
than scoring the email. These warn and never block: a false positive
that stops a legitimate send costs more than a marginal subject line.
Unknown merge fields remain the one hard block, because that is
unambiguously a mistake.

23 tests: 10 over the MIME builder (header order, both body parts,
RFC 2047 subject encoding round-tripping an em dash, no line over the
SMTP limit) and 13 over the content checker, including that a
{{merge_field}} link is not treated as off-domain.


---

## Pin the settlements mock store to globalThis

*87a9ca9 · 25 August 2026*

Next hands route handlers a different module instance from pages, so
the module-level Map was a separate store in each: settlements imported
through a route were invisible to the pages reading them, and vice
versa. This is the other half of the bug already fixed in
lib/db/repos.ts.

Real Postgres hides it because both instances read the same database,
so it only surfaces in mock mode. Pinning to a Symbol.for key also
survives dev hot-reload, which the module-level version did not.


---

## Document the Mailflow deployment step and its env vars

*69135e7 · 25 August 2026*

CRON_SECRET was missing from the env template entirely — every cron
route fails open without it, which now includes the one that sends
campaign email. CAMPAIGN_POSTAL_ADDRESS and CAMPAIGN_UNSUBSCRIBE_MAILTO
were undocumented too.

Adds Step 8 to the deployment guide covering the plan requirement (the
two hourly crons do not fire on Hobby, which only runs a cron daily),
the migrations, the deliverability prerequisites, and a verification
pass that insists on the one-click unsubscribe acting immediately.


---

## Attribute landing page enquiries to the page they came through

*6f56a3c · 25 August 2026*

A page reported its embedded form's *total* submissions, so a form used
on three pages showed the same figure on all three, and a draft page
that had never been visited claimed 142 enquiries that arrived
somewhere else entirely — visible on the pages list as a conversion
rate against zero visits.

Attribution has to be recorded when the enquiry arrives; it cannot be
reconstructed afterwards. Adds a nullable page_id to form_submissions,
threads it from the published page through the form component, and
counts conversions on it.

The claim itself is checked rather than trusted: the submit endpoint is
public and unauthenticated, so an id is accepted only when it names a
published page that actually embeds that form. A rejected claim is
recorded as no page rather than refusing the enquiry — the enquiry is
still real. The check sits in submitForm rather than the route so every
path into it is covered.

Submissions predating this carry no page, so the pages list reads zero
until new enquiries arrive. That is the honest answer; the old number
was worse than none.


---

## Schedule the marketing crons daily so the deployment builds

*f30d4cb · 26 August 2026*

Vercel rejects sub-daily cron schedules on Hobby at deploy time — it
fails the build outright rather than accepting the file and skipping
the runs. The two hourly entries this branch added therefore broke
every preview deployment of it, while main (one daily cron) kept
deploying fine.

Moves campaigns to 08:00 AEST and automations to 08:30 AEST so the
branch deploys as-is. The cost is real and documented: a campaign
scheduled for 2pm goes out the next morning, and a sequence advances
one step per day. Step 8.1 now carries the two-line change to put them
back on the hour once the account is on Pro.


---

## Put Mailflow on the launcher

*aa0fb8d · 26 August 2026*

The root page already lists the surfaces a broker can open; Mailflow was
missing from it, so the only way in was to know the /marketing URL and
type it. Landing on a page headed "LoanFlow" with no mention of the
marketing module reads as though it was never deployed.


---

## Give Mailflow its own front door

*1a76c07 · 26 August 2026*

The root page was LoanFlow's launcher — LoanFlow's name at the top,
LoanFlow's surfaces listed beneath. Adding Mailflow to that list made
it reachable but still read as a sub-page of something else, which is
why the app kept looking like it said LoanFlow.

Rebuilds / as a Mankin launcher: the firm at the top, the two products
as peers below it, and LoanFlow's internal surfaces demoted to a small
"Inside LoanFlow" row. Nobody arrives at a launcher to visit the
styleguide.

Adds MailflowLogo as a deliberate sibling of LoanflowLogo rather than a
stranger — same pill language, same flow arc, but the pills lie
left-aligned and descending so they read as the lines of a message
instead of the stages of a loan. The accent moves to the top pill: on
LoanFlow it marks the last cell, the settled one, because that is where
a loan is going; on Mailflow it marks the subject line, because that is
what decides whether the rest gets read. Gold against LoanFlow's green,
both already in the palette, so neither product invents a colour.

The wordmark also goes at the top of Mailflow's sidebar. The chrome is
otherwise identical to LoanFlow's, and a broker three clicks deep
should never have to work out which of the two they are in.

Also honours LoanflowLogo's `label` prop, which was documented and
accepted but ignored — the wordmark was hard-coded.


---

## Build saved email templates, and stop four nav items 404ing

*c326376 · 28 August 2026*

Templates, File manager, Integrations and Settings were rendered as
links with no pages behind them, so clicking any of them landed a
broker on a 404. That is most of what "it's missing so much" looks like
from inside the product.

Templates is now built. Two shelves in one gallery: templates saved by
the team above, and a library of eight that ship in code below, so the
module is useful the first time it is opened rather than after someone
has populated it. Every built-in is an email a brokerage actually sends
— fixed rate expiring, rate review, annual check-in, cash rate
decision, local market, equity check, been-a-while, EOFY — and a test
asserts each one uses only merge fields the loan book can answer, so
none of them renders a gap in a customer's inbox.

Using a template copies its wording into a new campaign rather than
referencing it. A campaign that read from a template would change
retroactively when the template was edited, including one already
scheduled to send tonight.

Brokers work the other way round too, so the campaign editor gains
"Save as template": most templates start life as an email someone wrote
once and then wished they still had.

The three items still unbuilt now render as greyed rows that cannot be
clicked. A row saying "not yet" is honest; a dead link is not.

Also brings the form-tables rescue helper in step with migration 0017,
which added form_submissions.page_id — the helper would otherwise
recreate the table without the column and every insert would fail.


---

## Add tags, saved segments, subject A/B testing and non-opener follow-up

*bdff53e · 28 August 2026*

Four gaps against Mailchimp, in the order they compound.

Tags. Keyed on the email address rather than a contact id, because a
Mailflow contact is derived from a settlement or a live deal and the
same person can be both — the address is the only identity that
survives across sources. Applied in bulk from the list or one at a time
from the detail panel, filterable there, and usable as an audience
clause. Include is any-of rather than all-of: a broker tagging someone
"investor" and "self-employed" is describing them, not building a
conjunction that would resolve to nobody. Exclusion beats inclusion,
because "not this group" is the stronger instruction. Comparison is
case-insensitive everywhere — "Investor" on Monday and "investor" on
Friday meant the same label, and disagreeing would silently mail half
the group.

Saved segments. The filter, not its members: a segment recalculates on
every use, so "settled two years ago" picks up whoever has since
qualified. A campaign copies the filter rather than pointing at it, so
editing a segment cannot change who a scheduled send reaches tonight.

Subject A/B testing. A slice of the audience is split evenly between
two subjects, opens are given a few hours, and the winner goes to the
holdback. Assignment alternates rather than splitting the list in half,
because the audience arrives sorted by settlement date and a contiguous
split would measure loan age instead of the subject. The test group is
rounded to an even number so one arm cannot win ties on size alone, and
an audience under 40 is refused outright rather than reporting noise as
a result. Only the subject is tested: two variables at this list size
gives an answer that cannot be read but will be believed. Ties break to
A and say so.

Non-opener follow-up. From a finished campaign's report, a draft
narrowed to the people it reached who never opened it. Stored as the
earlier campaign's id rather than a frozen address list, so someone who
opens the original tomorrow drops out. The subject is left blank on
purpose — it is the part that failed.

Also replaces two dead placeholder controls with the real actions they
were standing in for: "add a condition" is now "save this audience as a
segment", and the editor gained "save as template".


---

## Merge remote-tracking branch 'origin/main' into claude/email-marketing-tool-bfyl09

*b6f7d15 · 7 September 2026*


---

## Merge main, and put back the dependency the merge removed

*5d2e482 · 7 September 2026*

main dropped lucide-react as an unused dependency, which was true on
main — every file importing it lives on this branch. Git merged that
deletion cleanly, because this branch never touched the line, and the
result would have failed to build the moment it reached CI: sixteen
Mailflow and brand files import from it.

Restores it and refreshes the lockfile. Typecheck, 366 tests and a
production build all pass on the merged tree.


---

## Fix three security defects found reviewing this branch

*766b92c · 12 September 2026*

All three are mine, all three are pre-merge, and all three were
described in comments as safe.

Email header injection, outlook-mime.ts. Every header value went
through encodeHeaderValue, which base64-encodes anything outside
printable ASCII and so neutralises CR/LF — every value except To:,
which was interpolated raw. The address reaching it comes from a
public, CORS-open form endpoint, and validateSubmission only
shape-checked an address when the form's own field list included
"email"; two shipped templates omit it. A submission of
"attacker@x.com\r\nBcc: victim@y.com" would therefore have added a real
Bcc to a message Exchange then signs with the firm's DKIM key.

Fixed at the sink, where it holds for every caller: assertHeaderSafe
rejects CR/LF in the recipient, sender, subject and both unsubscribe
headers. Also fixed at the source — an address is now shape-checked
whenever one is present, not only when the form asked for one.

Open redirect, /e/c/[token]. The route forwarded to ?u= outside the
verification block, so the token gated only the analytics write. Any
token, or none, would redirect. safeRedirectTarget pins the scheme but
not the host, and /e/ is unauthenticated, which made the firm's own
domain a redirector into anyone's phishing page — precisely defeating
"only click mankinfinance.com links".

Now forwards only for a token carrying our signature. An expired one
still forwards: jose verifies the signature before it reads exp, so
"expired" means genuinely ours and merely old, and a year-old email
should still land where it promised. Forged or absent goes to the site
root.

Fail-open crons. The three new routes skipped the check entirely when
CRON_SECRET was unset or empty, leaving /api/cron/campaigns — which
sends real email — callable by anyone. main had already hardened its
own crons to fail closed; this branch reintroduced the pattern that
change removed. Now matches: secret must exist and match, compared with
the existing constant-time helper.

Two comments claimed protections that did not exist. Both corrected
rather than deleted, because the next person will believe them.

Adds 11 regression tests. 377 pass.


---

## Build the Mailflow settings screen

*564c725 · 21 September 2026*

Settings was the third of four dead nav items. It is also where the
module's configuration lived — in environment variables, which meant
the person who writes the campaigns could not change the address
printed at the bottom of them without a commit and a redeploy. That is
how a footer stays wrong for a year.

Now editable: the postal address and unsubscribe mailbox that go in
every campaign footer, whether new campaigns track opens and clicks,
and how many emails go out per scheduled run. Environment variables
remain the fallback, and the form says when a value is still coming
from one, so the source of a filled field is never a mystery.

The pace control reads the real schedule out of vercel.json rather than
restating it. Hard-coding "hourly" beside it would have been wrong the
moment the crons moved to daily for the Hobby plan — instead the page
works out that 785 contacts at 60 a run is a fortnight, and says why.

The sending-domain panel is deliberately read-only and says the app
cannot verify SPF, DKIM or DMARC itself; it prints the dig commands
instead. A green tick this app invented would be worse than no tick,
and the dashboard's existing hardcoded "Authenticated" is the reason
that needed saying.

Two bugs the tests caught while writing them:

Zod's .partial() still applies each field's default, so parsing an
empty stored row returned a full set of defaults that silently
overwrote the environment layer — a deployment with
CAMPAIGN_POSTAL_ADDRESS set would have lost it the moment any setting
was saved. Presence in the raw object is now the test, which is also
what lets clearing the field in the UI actually clear it.

The second was my own arithmetic in a test expectation, not the code's.

Also extracts the send-pacing constants into a pure module so settings
can read the default without pulling in server-only code, and threads
the footer address through renderCampaign as an argument rather than an
environment read, keeping merge.ts pure.

23 new tests, 400 pass.


---

