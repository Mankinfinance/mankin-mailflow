# Deliverability

How to keep Mailflow's email out of the junk folder. Settings → Sending
domain reads the records below from public DNS and shows each one's
status and fix, so check there first; the dashboard's "Sending domain"
badge says "Authenticated" only when SPF and DKIM pass and a DMARC
record exists.

Mailflow sends through Microsoft 365 (Graph, raw MIME) from each
broker's own mailbox. It already does the parts that live in the
message itself: `List-Unsubscribe` with RFC 8058 one-click, a real
plain-text part, a domain-correct `Message-ID`, `Precedence: bulk`, the
postal address and the licence lines. What it cannot do is the DNS.

## Where mankinfinance.com stood on 23 September 2026

| Check | Status | Record |
| --- | --- | --- |
| SPF | Passing | `v=spf1 include:_spf.mlsend.com include:spf.protection.outlook.com -all` |
| DKIM (Microsoft 365) | **Missing** | no `selector1._domainkey` or `selector2._domainkey` |
| DKIM (MailerLite) | Present | `litesrv._domainkey` → `litesrv._domainkey.mlsend.com` |
| DMARC | Monitoring only | `v=DMARC1; p=none; rua=mailto:michael@mankinfinance.com` |
| Link domain | Shared | links and images point at `*.vercel.app` |

`mankinfinance.com.au` has SPF (`include:spf.protection.outlook.com -all`)
and no DMARC record.

## 1. Switch on DKIM in Microsoft 365 (the important one)

Without it, Exchange Online signs Mailflow's mail as the tenant's
`onmicrosoft.com` domain. DMARC then rests on SPF alone, and SPF breaks
whenever a client's mail is forwarded, which is exactly when it lands in
junk.

1. Sign in to <https://security.microsoft.com/authentication?viewid=DKIM>
   as a Microsoft 365 admin (Email & collaboration → Policies & rules →
   Threat policies → Email authentication settings → DKIM).
2. Click `mankinfinance.com`. If it offers "Create DKIM keys", do that.
3. The panel shows two CNAME records, `selector1._domainkey` and
   `selector2._domainkey`, each pointing at a long Microsoft host. Copy
   them exactly; the targets are specific to this tenant.
4. Add both as CNAME records at the DNS host for mankinfinance.com
   (wherever the SPF record above is managed).
5. Wait for them to resolve (minutes to an hour), then back in the DKIM
   panel switch "Sign messages for this domain with DKIM signatures" on.
6. Settings → Sending domain should show DKIM passing within half an
   hour. Send yourself a test and check the headers show
   `dkim=pass header.d=mankinfinance.com`.

Repeat for `mankinfinance.com.au` if anyone sends from that domain.

## 2. Point DMARC reports somewhere useful

Aggregate reports are XML attachments, several a day. Sending them to a
broker's inbox buries them. Change the record at `_dmarc.mankinfinance.com`
to use a shared mailbox, or a free report reader (Postmark's DMARC
digests, dmarcian, EasyDMARC), for example:

```
v=DMARC1; p=none; rua=mailto:dmarc@mankinfinance.com; fo=1
```

Add one for the `.com.au` too. If that domain never sends email, use
`v=DMARC1; p=reject;` so nobody can send as it.

## 3. Serve links from the firm's own domain

Every tracked link, unsubscribe link and image in an email is built from
`NEXT_PUBLIC_APP_URL`. A `*.vercel.app` address is shared with every
other project on Vercel, and filters score it on their behaviour too; it
also does not match the From address, which is a phishing signal in a
finance email.

1. Vercel → mankin-mailflow → Settings → Domains → Add, for example
   `mail.mankinfinance.com`.
2. Add the CNAME Vercel shows (`cname.vercel-dns.com`) at the DNS host.
3. Once Vercel shows it valid, change `NEXT_PUBLIC_APP_URL` to
   `https://mail.mankinfinance.com` and redeploy.
4. If sign-in is pinned with `AUTH_URL`, change it to match, and add the
   new callback URL (`https://mail.mankinfinance.com/api/auth/callback/microsoft-entra-id`)
   to the Entra app registration.

Keep the old vercel.app address working: emails already sent link to it.

## 4. Tighten DMARC once DKIM is clean

After DKIM has been on for two to four weeks and the reports show no
legitimate mail failing (MailerLite, Microsoft 365, any website form or
CRM that sends as the domain), change `p=none` to `p=quarantine`. Later,
`p=reject`. Anything that sends as the domain and is not in the reports
as passing will start going to junk, so check the reports first.

## 5. Sending practice

DNS gets mail considered; behaviour decides where it lands.

- **Warm up.** For the first campaigns, send to the most engaged part of
  the book first (recent settlements, people who have replied), a few
  hundred at a time, and grow over two to three weeks. The batch size in
  Settings controls the pace (60 every five minutes by default).
- **Only people who expect it.** Clients with a relationship, not a
  bought or scraped list. The Spam Act requires consent and an
  unsubscribe, both of which Mailflow enforces.
- **Watch the dashboard.** Sending health turns amber at 2% bounces or
  0.5% unsubscribes, and red at 5% or 1%; red means stop and clean the
  list before the next send. The provider breakdown shows if one inbox
  (Gmail, Outlook, Bigpond) is treating the firm differently.
- **Clear the spam check.** The editor flags capitals, repeated
  punctuation, figures in the subject, very short bodies, too many links,
  shortened links, links to other people's domains, sales phrases and
  leftover `[placeholders]`. The built-in templates pass it.
- **Look personal.** Sent from a broker's own name and mailbox, a real
  subject, a plain-text part, and a reply goes to a person. Mailflow
  already does this; keep the From as a person rather than "Mankin
  Finance Marketing".
- **Test before a big send.** "Send me a test" to a Gmail and an
  Outlook.com address as well as your own mailbox, and look at where it
  lands, not only how it looks.

## Why not Google Postmaster Tools or Microsoft SNDS

Postmaster Tools needs roughly a hundred messages a day to Gmail before
it shows anything. SNDS and JMRP are keyed on sending IP, and Exchange
Online's outbound pool is shared, so neither applies. Mailflow's own
per-provider breakdown (`lib/campaigns/domains.ts`) is the substitute.
