/**
 * What the assistant knows about Mailflow without looking anything up.
 *
 * Written from the screens themselves — every button and field named
 * here was read out of the component that renders it, not recalled —
 * because an assistant that tells a broker to press a button that does
 * not exist is worse than no assistant. When a screen changes, this
 * changes with it. The Notion SOPs are written from the same survey.
 *
 * Kept static so it can sit at the front of the system prompt under a
 * cache breakpoint: it is most of the prompt, and it is identical on
 * every request.
 */
export const MAILFLOW_GUIDE = `
# Mailflow — what it is

Mailflow is Mankin Finance's email marketing platform, used by the brokers and support team. It sends as the broker's own Microsoft 365 mailbox (so replies go to the broker and sends appear in their Sent Items), reads contacts from two sources, and writes activity onto the client's deal in LoanFlow.

Contacts come from:
- The back-book: settled loans from the aggregator commission file (the "settlements" data shared with LoanFlow). Contacts arrive in monthly batches when the file is imported, so nothing new is expected between imports.
- The live pipeline: the deals LoanFlow imports from Salestrekker into the shared database.

Left navigation, top to bottom: Dashboard, Subscribers, Campaigns, Automations, Forms, Surveys, Landing pages, Templates, File manager, Webhooks, Settings. The gold "+ Create" button is top right.

# Dashboard
Shows "Last sent campaign", a "Performance overview" for the last 30 days (active contacts, new today, new this month, opted out), "Campaign engagement, this month", "Sending health, last 30 days" (bounced, spam complaints, unsubscribed, marked Healthy / Worth watching / Needs attention), Automations and Forms summaries.

# Subscribers
Two groups: Back-book and Live pipeline. Search by name or email. Each person shows source, status, lender, loan amount, owning broker and campaign activity. From here you can "Add tag", mark "Do not market", or "Start a campaign" for a selection ("Select all on this page").

The Do-not-market register (Campaigns → "Do-not-market list", or /marketing/suppressions) lists everyone who unsubscribed or hard-bounced, with how they came off. "Add by hand" adds someone. Removing someone requires confirming "Remove, and log it against my name" — only do this with the client's documented consent.

# Campaigns — sending one
1. Campaigns → "New campaign" (or "+ Create").
2. Message panel: "Campaign name" (internal), "Send from" (which broker's mailbox), "Subject line", and "Body". Click a merge field to insert it.
3. Merge fields: {{first_name}}, {{last_name}}, {{full_name}}, {{lender}}, {{loan_amount}}, {{current_balance}}, {{settlement_date}}, {{years_since_settlement}}, {{loan_status}}, {{broker_name}}, {{broker_first_name}}, {{broker_phone}}, {{broker_email}}, {{booking_url}}. A misspelt field (e.g. {{firstname}}) is caught while it is still a draft: sending is held with "Held until the unknown merge field is corrected".
4. Audience: start from "the back-book" or "the live pipeline", then narrow by owning broker, loan status (active, closed, discharged), settlement date range, lender, balance range, pipeline stage and tag, and optionally leave out anyone contacted in the last N days. You can keep an audience so it can be reused; it recalculates each time.
5. Optional A/B test: "Test a second subject line" adds "Subject line B". A share of the audience gets each; after the test window the winning subject goes to everyone else automatically. "Remove the test" undoes it.
6. The "This reaches" rail on the right shows exactly who will receive it. "Send me a test" emails you a copy first. Always send yourself a test.
7. Optionally "Schedule for" a date and time. Mailflow suggests a best hour, worked out from when your contacts have clicked in the past (not opens — Apple Mail Privacy Protection makes open times meaningless).
8. Press "Send to N people" (or "Schedule for N people"). "Save draft" and "Save as template" are also on the rail.

Sending is paced: the "Send pace" setting (10–120 per run, default 60) is how many emails each campaign sends per run, and the sender runs every five minutes. Exchange Online allows about 30 a minute per mailbox, so 60 per five minutes is comfortably inside it. Large campaigns therefore take a while to drain; that is normal.

Every campaign automatically carries the unsubscribe footer, the postal address from Settings, the broker signature and the ACR/ACL licence lines. You cannot remove them and should not add your own.

Once a campaign has reached customers its content is locked.

# Campaigns — reading results
The campaign report shows Sent, Opened, Clicked, Opted out, Did not send, and "The first 72 hours" engagement curve, a click map of which links were clicked, and a domain breakdown.

Treat opens as a rough signal only: Apple Mail Privacy Protection fetches the tracking pixel automatically, so opens are inflated. Clicks are the reliable measure of interest.

# Automations (sequences)
Sequences send on their own when something happens. Automations → start from a template ("Start with something the book already knows") or "Build from an empty canvas".

Templates: 12-month settlement anniversary · Pre-approval going cold at 60 days · Three months after settlement · Two years since settlement · Two weeks at lodged with no news · Welcome, just after settlement · Refinanced away, six months on · Welcome a new enquiry · Follow up a tagged contact · A quarter of the loan paid off · Ask how it went.

Triggers (what enrols someone): a settlement anniversary (N months after settlement), a pipeline stage (deal sitting at a stage for N days), a form submission, a tag being added, an equity milestone (a share of the original loan paid down).

Steps on the canvas: Send, Delay, Condition ("Opened the email?" / "Clicked the link?" within N days, or a question about the contact: tagged, lender, balance, loan age, broker), Split (A/B share of contacts), Survey, Exit. Each exit step has a note explaining why the sequence ends there.

Controls: "Turn on", "Pause", "Resume", "Delete". Each person enters a sequence once. Someone who unsubscribes is stopped before their next step. The canvas shows per-step counts: Entered, Sent, Opened, Waiting here, Dropped.

Automations run on a schedule every 15 minutes, so a delay or trigger can take up to 15 minutes to act.

# Forms
Forms → "Start with a template" or start from scratch. Set "Internal name", the fields ("What to ask for"), "Headline", "Supporting line", "Button", "Consent line", and "Where the enquiry lands": "Create a deal in the loan pipeline" (choose "Assign to" and "Starting stage"; the deal appears in LoanFlow's pipeline) or "Record the enquiry only". "Publish" makes it live; "Take it down" unpublishes. "Put it on the website" gives the "Embed code" and a "Hosted link".

# Landing pages
Landing pages → a template or "Blank page". Blocks: Heading, Paragraph, a form (pick a live form — publish one in Forms first), testimonials. Set "Page title", "Search description" and "Web address", then "Publish". "View live page" opens it.

# Surveys
Surveys → create from a template. A survey is NOT sent from the Surveys screen: open it ("Open it"), then add a Survey step to an automation and put {{survey_link}} in that email's body. Each client gets a link signed for them, so their answer arrives with their name without signing in. Results show the Net Promoter score, but only once there are at least 30 answers; below that it would be noise. "Close" stops accepting answers; "Reopen" resumes.

# Templates and File manager
Templates: reusable email designs ("Start from the library" or "Saved by the team"), also reachable from Campaigns → "Start from a template". The library has 41 ready-written emails across Rate review, Market update, Anniversary, Welcome & settlement, Pipeline, Goals, Explainers, Referrals & reviews, Re-engagement and Seasonal. Using one starts a campaign. Anything in [square brackets] is a placeholder to fill in, and the spam check warns while one is left. Booking links use {{booking_url}}, the sending broker's own calendar; a broker without one gets "Just reply to this email and we'll find a time." instead. File manager: upload images for emails; always fill "Alt text — what a blocked image should say", because most email clients block images by default. "Copy snippet" copies the image for pasting into a body.

# Webhooks
Webhooks tell other systems what happened. "Add an endpoint" → Name, URL (HTTPS only, and never an internal address), a note, and "What to send". Copy the signing secret when it is shown — it is shown once. "Send a test" checks the receiver. "Recent deliveries" shows what was delivered, retried or abandoned.

Events: contact.unsubscribed, contact.bounced, contact.clicked (first click per person per email), campaign.sent, campaign.failed (nothing delivered at all), survey.responded, survey.detractor (score 0–6), form.submitted (a lead), automation.entered (a trigger fired), automation.completed (reached an end the author designed), automation.exited (stopped by an unsubscribe or a sequence that could not run). There is deliberately no event per open.

Deal notes: Mailflow writes a note onto the client's deal automatically for a milestone that started a sequence, a sequence finishing, a first click, an unsubscribe, a bounce, and a survey answer. The notes appear in LoanFlow, in the deal drawer under "Notes", headed "Mailflow". Only contacts who came from the pipeline get notes; the settled back-book has no open deal to write on.

The pipeline is the deals LoanFlow imports from Salestrekker into the database both products share. There is no live connection to Salestrekker itself: nothing Mailflow does is sent to Salestrekker, and deals created by forms appear in LoanFlow's pipeline, not in Salestrekker. Never tell anyone something will appear in Salestrekker.

# Settings
The panel at the very top, "Where the data lives", says whether anything is being kept. "Set up the tables" applies database updates; it is safe to press at any time and does nothing when there is nothing to do. Press it after any Mailflow update. "Details" opens /marketing/settings/database, which shows the build, whether the database is reachable, and which tables exist.

Below that: "Postal address" and "Unsubscribe mailbox" (both printed on every campaign), "Send pace", and default "Track opens" / "Track clicks". "Save settings".

# Opt-outs and compliance
Australia's Spam Act 2003 requires a working unsubscribe on every marketing email and that opt-outs are honoured within five business days. Mailflow honours them immediately. Every email has the footer link (which asks the person to confirm, so link-scanners cannot unsubscribe people) and the one-click header that Gmail, Outlook and Yahoo use for their own unsubscribe button (which acts immediately). The opt-out is checked again right before every send, in both campaigns and sequences. An unsubscribe stops marketing email only; loan correspondence still reaches the client.

Hard bounces are found hourly by reading non-delivery reports in the sending mailboxes and are added to the register automatically.

# When something is wrong
- "Nothing you create here is being kept": no DATABASE_URL — ask the administrator.
- Nothing scheduled ever sends, sequences never move: the CRON_SECRET environment variable is missing in Vercel. Every scheduled job is refused without it.
- Sign-in fails with AADSTS50011: you started from a deployment-specific address (with a hash in it). Use https://mankin-mailflow.vercel.app.
- A campaign sits at "sending" for a long time: normal for a large audience; it sends a paced batch every five minutes.
- A campaign failed completely (campaign.failed): usually the Microsoft Graph sending credentials have expired or the mailbox is blocked. Tell Michael.
- After an update, press "Set up the tables" in Settings.
`.trim();
