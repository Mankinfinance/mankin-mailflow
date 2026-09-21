/**
 * Step-by-step SharePoint upload diagnostic.
 *
 * Mirrors exactly what lib/clients/sharepoint.ts does at runtime.
 * Each step prints PASS or FAIL with the precise error so we can
 * identify which env var or permission is the problem.
 *
 * Usage (PowerShell):
 *   $env:MS_GRAPH_TENANT_ID = "..."
 *   $env:MS_GRAPH_CLIENT_ID = "..."
 *   $env:MS_GRAPH_CLIENT_SECRET = "..."
 *   $env:SHAREPOINT_DRIVE_ID = "..."
 *   node scripts/diagnose-sharepoint.mjs
 */

const tenantId = process.env.MS_GRAPH_TENANT_ID;
const clientId = process.env.MS_GRAPH_CLIENT_ID;
const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;
const driveId = process.env.SHAREPOINT_DRIVE_ID;
const ROOT_FOLDER = "Deal applications";
const GRAPH = "https://graph.microsoft.com/v1.0";

function checkEnv() {
  const missing = [];
  if (!tenantId) missing.push("MS_GRAPH_TENANT_ID");
  if (!clientId) missing.push("MS_GRAPH_CLIENT_ID");
  if (!clientSecret) missing.push("MS_GRAPH_CLIENT_SECRET");
  if (!driveId) missing.push("SHAREPOINT_DRIVE_ID");
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("Step 0: Env vars present. PASS");
  console.log(`   Tenant ID:   ${tenantId.slice(0, 8)}...${tenantId.slice(-4)}`);
  console.log(`   Client ID:   ${clientId.slice(0, 8)}...${clientId.slice(-4)}`);
  console.log(`   Secret:      ${clientSecret.slice(0, 4)}...${clientSecret.slice(-4)} (length ${clientSecret.length})`);
  console.log(`   Drive ID:    ${driveId.slice(0, 30)}...`);
  console.log();
}

async function getToken() {
  const resp = await fetch(
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

  const body = await resp.text();
  if (!resp.ok) {
    console.error(`Step 1: Token acquisition. FAIL (${resp.status})`);
    console.error("   Response body:", body);
    console.error();
    console.error("   Likely causes:");
    console.error("   - Wrong tenant ID");
    console.error("   - Wrong client ID");
    console.error("   - Wrong client secret (or used Secret ID instead of Value)");
    console.error("   - Client secret expired");
    process.exit(1);
  }
  const json = JSON.parse(body);
  console.log("Step 1: Token acquisition. PASS");
  console.log(`   Token expires in: ${json.expires_in}s`);
  console.log();
  return json.access_token;
}

async function checkDrive(token) {
  const resp = await fetch(
    `${GRAPH}/drives/${encodeURIComponent(driveId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const body = await resp.text();
  if (!resp.ok) {
    console.error(`Step 2: Read drive metadata. FAIL (${resp.status})`);
    console.error("   Response body:", body);
    console.error();
    if (resp.status === 403) {
      console.error("   Likely cause: admin consent not granted (or still propagating).");
      console.error("   Fix: Entra ID > app > API permissions > Grant admin consent. Wait 10 min.");
    } else if (resp.status === 404) {
      console.error("   Likely cause: SHAREPOINT_DRIVE_ID is wrong.");
      console.error("   Fix: re-run scripts/resolve-drive-id.mjs to get the correct one.");
    } else if (resp.status === 401) {
      console.error("   Likely cause: token rejected. Permission scope wrong.");
    }
    process.exit(1);
  }
  const json = JSON.parse(body);
  console.log("Step 2: Read drive metadata. PASS");
  console.log(`   Drive name:    ${json.name}`);
  console.log(`   Drive type:    ${json.driveType}`);
  console.log(`   Web URL:       ${json.webUrl}`);
  console.log();
}

async function listRoot(token) {
  const resp = await fetch(
    `${GRAPH}/drives/${encodeURIComponent(driveId)}/root/children?$select=name,folder,file&$top=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const body = await resp.text();
  if (!resp.ok) {
    console.error(`Step 3: List drive root contents. FAIL (${resp.status})`);
    console.error("   Response body:", body);
    process.exit(1);
  }
  const json = JSON.parse(body);
  const children = json.value || [];
  console.log("Step 3: List drive root contents. PASS");
  console.log(`   Found ${children.length} item(s) at drive root:`);
  for (const c of children.slice(0, 20)) {
    const kind = c.folder ? "[folder]" : "[file]  ";
    console.log(`     ${kind} ${c.name}`);
  }
  if (children.length > 20) console.log(`     ... and ${children.length - 20} more`);

  const hasDealApps = children.some(
    (c) => c.folder && c.name?.toLowerCase() === ROOT_FOLDER.toLowerCase(),
  );
  console.log();
  if (hasDealApps) {
    console.log(`Step 3b: "${ROOT_FOLDER}" folder exists at drive root. PASS`);
  } else {
    console.log(`Step 3b: "${ROOT_FOLDER}" folder NOT found at drive root. WARN`);
    console.log("   The drive ID may point to a folder that's already INSIDE the");
    console.log(`   "${ROOT_FOLDER}" folder. The upload code expects to find it at`);
    console.log("   the drive's root level. We'll try to create a test folder anyway.");
  }
  console.log();
}

async function testFolderCreate(token) {
  const testFolderName = `_diagnostic_test_${Date.now()}`;
  // First try at the configured root path (under "Deal applications")
  const url = `${GRAPH}/drives/${encodeURIComponent(driveId)}/root:/${encodeURIComponent(ROOT_FOLDER)}:/children`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: testFolderName,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });

  const body = await resp.text();
  if (resp.ok) {
    console.log("Step 4: Create test folder under Deal applications. PASS");
    console.log(`   Created: ${testFolderName}`);
    console.log("   (We'll leave it there. Delete it manually from SharePoint later.)");
    console.log();
    return true;
  }

  console.error(`Step 4: Create test folder under Deal applications. FAIL (${resp.status})`);
  console.error("   Response body:", body);
  console.error();
  if (resp.status === 404) {
    console.error('   Likely cause: "Deal applications" folder does not exist at the');
    console.error("   drive's root. Either create it in SharePoint, or set SHAREPOINT_DRIVE_ID");
    console.error("   to a drive that contains it.");
  } else if (resp.status === 403) {
    console.error("   Likely cause: app token lacks write permission on this drive.");
    console.error("   Files.ReadWrite.All requires admin consent. Re-grant it.");
  }
  return false;
}

console.log("=== SharePoint upload diagnostic ===\n");
checkEnv();
const token = await getToken();
await checkDrive(token);
await listRoot(token);
await testFolderCreate(token);
console.log("\n=== Diagnostic complete ===");
