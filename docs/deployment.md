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

Both repos define the same tables, so decide which one runs migrations
against a shared database before pointing the second at it.

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
- **`AADSTS50011`** → redirect URI missing or mistyped in the Entra app
- **`AADSTS7000215`** → wrong client secret, usually the Secret ID copied instead of the Value
- **500 or an application error** → an env var is missing; check Runtime Logs
- **A warning that `middleware.ts` cannot be found** → a false positive. Next 16 renamed middleware to `proxy.ts`; ignore it.
