/**
 * Resolve a SharePoint sharing URL to the underlying drive ID + driveItem ID.
 *
 * Usage (PowerShell):
 *   $env:MS_GRAPH_TENANT_ID = "..."
 *   $env:MS_GRAPH_CLIENT_ID = "..."
 *   $env:MS_GRAPH_CLIENT_SECRET = "..."
 *   node scripts/resolve-drive-id.mjs "https://mankinfinance.sharepoint.com/:f:/s/..."
 *
 * Prints the drive ID. Paste that into Vercel as SHAREPOINT_DRIVE_ID.
 */

const shareUrl = process.argv[2];
if (!shareUrl) {
  console.error("Usage: node scripts/resolve-drive-id.mjs <sharepoint-share-url>");
  process.exit(1);
}

const tenantId = process.env.MS_GRAPH_TENANT_ID;
const clientId = process.env.MS_GRAPH_CLIENT_ID;
const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;

if (!tenantId || !clientId || !clientSecret) {
  console.error("Missing env: MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET");
  process.exit(1);
}

// Step 1: Acquire app-only token via OAuth2 client_credentials.
const tokenResp = await fetch(
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
  {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
  },
);

if (!tokenResp.ok) {
  const body = await tokenResp.text();
  console.error("Token request failed:", tokenResp.status, body);
  process.exit(1);
}

const { access_token: token } = await tokenResp.json();
console.log("Token acquired.");

// Step 2: Encode the share URL to Graph's share-token format.
// Spec: prefix with "u!", then URL-safe base64-encode without padding.
const encoded =
  "u!" +
  Buffer.from(shareUrl)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

console.log(`Encoded share token: ${encoded.slice(0, 40)}...`);

// Step 3: Resolve to a driveItem.
const shareResp = await fetch(
  `https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`,
  { headers: { Authorization: `Bearer ${token}` } },
);

if (!shareResp.ok) {
  const body = await shareResp.text();
  console.error("Share resolution failed:", shareResp.status, body);
  process.exit(1);
}

const item = await shareResp.json();

console.log("\n=== RESULT ===\n");
console.log("Drive ID:        ", item.parentReference?.driveId ?? "(not found)");
console.log("Drive Item ID:   ", item.id ?? "(not found)");
console.log("Folder name:     ", item.name ?? "(not found)");
console.log("Web URL:         ", item.webUrl ?? "(not found)");
console.log("\nPaste the Drive ID above into Vercel as SHAREPOINT_DRIVE_ID.");
