/**
 * Microsoft Entra ID SSO diagnostic for Auth.js v5.
 *
 * Tests the four env vars that gate broker sign-in. Each step prints
 * PASS or FAIL with the precise reason so we can identify which
 * variable is wrong without digging through Vercel runtime logs.
 *
 * Usage (PowerShell):
 *   $env:AUTH_SECRET = "..."
 *   $env:AUTH_MICROSOFT_ENTRA_ID_ID = "..."
 *   $env:AUTH_MICROSOFT_ENTRA_ID_SECRET = "..."
 *   $env:AUTH_MICROSOFT_ENTRA_ID_ISSUER = "https://login.microsoftonline.com/<tenant-id>/v2.0"
 *   node scripts/diagnose-sso.mjs
 */

const authSecret = process.env.AUTH_SECRET;
const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;

console.log("=== Microsoft SSO diagnostic ===\n");

/* -------------------------------------------------------------------------- */
/* Step 0: env vars present                                                   */
/* -------------------------------------------------------------------------- */

function checkEnv() {
  const missing = [];
  if (!authSecret) missing.push("AUTH_SECRET");
  if (!clientId) missing.push("AUTH_MICROSOFT_ENTRA_ID_ID");
  if (!clientSecret) missing.push("AUTH_MICROSOFT_ENTRA_ID_SECRET");
  if (!issuer) missing.push("AUTH_MICROSOFT_ENTRA_ID_ISSUER");
  if (missing.length > 0) {
    console.error(`Step 0: Env vars present. FAIL`);
    console.error(`   Missing: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("Step 0: Env vars present. PASS");
  console.log(`   AUTH_SECRET length:   ${authSecret.length} chars`);
  console.log(`   Client ID:            ${clientId.slice(0, 8)}...${clientId.slice(-4)}`);
  console.log(`   Client Secret length: ${clientSecret.length} chars (starts with "${clientSecret.slice(0, 3)}...")`);
  console.log(`   Issuer:               ${issuer}`);
  console.log();
}

/* -------------------------------------------------------------------------- */
/* Step 1: validate ISSUER shape                                              */
/* -------------------------------------------------------------------------- */

function checkIssuerShape() {
  const expected = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0$/i;
  const match = expected.exec(issuer);
  if (!match) {
    console.error("Step 1: Issuer URL shape. FAIL");
    console.error(`   Expected: https://login.microsoftonline.com/<tenant-uuid>/v2.0`);
    console.error(`   Got:      ${issuer}`);
    console.error();
    if (issuer.includes("<tenant-id>")) {
      console.error("   The literal text \"<tenant-id>\" is still in the URL.");
      console.error("   Replace it with your real Directory (tenant) ID UUID.");
    } else if (!issuer.endsWith("/v2.0")) {
      console.error("   The URL must end with \"/v2.0\".");
    }
    process.exit(1);
  }
  console.log("Step 1: Issuer URL shape. PASS");
  console.log(`   Tenant ID parsed: ${match[1].slice(0, 8)}...${match[1].slice(-4)}`);
  console.log();
  return match[1];
}

/* -------------------------------------------------------------------------- */
/* Step 2: OpenID metadata reachable                                          */
/* -------------------------------------------------------------------------- */

async function checkOpenIdConfig(_tenantId) {
  const url = `${issuer}/.well-known/openid-configuration`;
  const resp = await fetch(url);
  if (!resp.ok) {
    console.error(`Step 2: OpenID metadata reachable. FAIL (${resp.status})`);
    const body = await resp.text();
    console.error(`   Response: ${body.slice(0, 200)}`);
    console.error();
    if (resp.status === 400) {
      console.error("   Likely cause: tenant ID is wrong or the tenant doesn't exist.");
    }
    process.exit(1);
  }
  const json = await resp.json();
  console.log("Step 2: OpenID metadata reachable. PASS");
  console.log(`   Token endpoint: ${json.token_endpoint}`);
  console.log();
  return json;
}

/* -------------------------------------------------------------------------- */
/* Step 3: client_credentials smoke test                                      */
/* -------------------------------------------------------------------------- */
/* Note: the SSO app probably doesn't have application-level permissions      */
/* granted, so this will likely fail with "insufficient_scope" rather than    */
/* a successful token. That's fine - it still validates ID + secret are      */
/* correct. The errors we're looking for are "invalid_client" (wrong         */
/* credentials) vs the more benign "AADSTS65001" (consent needed).            */

async function checkClientCredentials(tenantId) {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
  });

  const body = await resp.text();
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    console.error("Step 3: Client credentials smoke test. FAIL");
    console.error(`   Could not parse response: ${body.slice(0, 200)}`);
    process.exit(1);
  }

  // Successful token = unusual for an SSO app, but harmless if it happens
  if (resp.ok && json.access_token) {
    console.log("Step 3: Client credentials smoke test. PASS");
    console.log(`   Got a token (unusual for an SSO app, but valid - means ID + secret are correct).`);
    console.log();
    return;
  }

  // Common diagnostic cases
  const code = json?.error;
  const desc = json?.error_description ?? "";

  if (code === "invalid_client") {
    console.error("Step 3: Client credentials smoke test. FAIL (invalid_client)");
    console.error(`   ${desc}`);
    console.error();
    console.error("   This is the bad one. Means either:");
    console.error("   - The CLIENT_SECRET value is wrong (used Secret ID instead of Value, or it expired)");
    console.error("   - The CLIENT_ID doesn't match the secret (mixed up SSO app vs SharePoint app)");
    console.error();
    console.error("   Fix: regenerate the secret in Entra > Certificates & secrets > New client secret,");
    console.error("   copy the Value column immediately, paste into Vercel as AUTH_MICROSOFT_ENTRA_ID_SECRET.");
    process.exit(1);
  }

  if (
    code === "invalid_request" ||
    code === "invalid_scope" ||
    desc.includes("AADSTS65001") || // consent needed
    desc.includes("AADSTS70011") || // scope not granted
    desc.includes("AADSTS500011") || // resource principal not found
    desc.includes("AADSTS500200") || // app needs consent
    desc.includes("AADSTS900971")
  ) {
    // These mean "credentials are valid, but you don't have permission to
    // do client_credentials" - which is exactly what we expect for an SSO
    // app. So credentials are fine.
    console.log("Step 3: Client credentials smoke test. PASS (credentials accepted)");
    console.log(`   Microsoft returned "${code}" with description "${desc.slice(0, 80)}..."`);
    console.log("   This is expected for an SSO app - it confirms your CLIENT_ID and CLIENT_SECRET");
    console.log("   are accepted by Microsoft. The error is just about permissions for client_credentials,");
    console.log("   which doesn't matter for the user-interactive sign-in flow.");
    console.log();
    return;
  }

  if (code === "unauthorized_client") {
    console.error("Step 3: Client credentials smoke test. FAIL (unauthorized_client)");
    console.error(`   ${desc}`);
    console.error();
    console.error("   The CLIENT_ID isn't a valid app in this tenant. Probably:");
    console.error("   - Tenant ID and Client ID are from different tenants");
    console.error("   - You used a different app's CLIENT_ID by mistake");
    process.exit(1);
  }

  // Unrecognised error
  console.error(`Step 3: Client credentials smoke test. FAIL (${code ?? "unknown"})`);
  console.error(`   ${desc}`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Step 4: AUTH_SECRET sanity                                                 */
/* -------------------------------------------------------------------------- */

function checkAuthSecret() {
  if (authSecret.length < 32) {
    console.error("Step 4: AUTH_SECRET length sanity. FAIL");
    console.error(`   AUTH_SECRET is only ${authSecret.length} chars long.`);
    console.error("   Auth.js v5 wants at least 32 chars of entropy.");
    console.error("   Regenerate with:");
    console.error("     node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
    process.exit(1);
  }
  console.log("Step 4: AUTH_SECRET length sanity. PASS");
  console.log();
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

checkEnv();
const tenantId = checkIssuerShape();
await checkOpenIdConfig(tenantId);
await checkClientCredentials(tenantId);
checkAuthSecret();

console.log("=== All checks passed ===\n");
console.log("If you're still getting the 500 in production, the most likely remaining");
console.log("cause is that the production deploy hasn't picked up the latest env vars.");
console.log("Go to Vercel > Deployments > latest > Redeploy and try again.");
