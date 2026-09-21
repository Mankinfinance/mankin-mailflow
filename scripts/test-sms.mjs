/**
 * Quick smoke test for SMS Broadcast credentials.
 * Sends one SMS to the number you pass on the command line.
 *
 * Usage (PowerShell):
 *   $env:SMS_BROADCAST_USERNAME = "you@mankinfinance.com.au"
 *   $env:SMS_BROADCAST_PASSWORD = "your-api-password"
 *   $env:SMS_BROADCAST_SENDER_ID = "Mankin"
 *   node scripts/test-sms.mjs 0411234567
 */

const phone = process.argv[2];
if (!phone) {
  console.error("Usage: node scripts/test-sms.mjs <phone-number>");
  process.exit(1);
}

const username = process.env.SMS_BROADCAST_USERNAME;
const password = process.env.SMS_BROADCAST_PASSWORD;
const from = process.env.SMS_BROADCAST_SENDER_ID ?? "Mankin";

if (!username || !password) {
  console.error("Missing SMS_BROADCAST_USERNAME or SMS_BROADCAST_PASSWORD env var");
  process.exit(1);
}

// Normalise to international
const digits = phone.replace(/\D+/g, "");
let to;
if (digits.startsWith("61") && digits.length === 11) to = digits;
else if (digits.startsWith("04") && digits.length === 10) to = "61" + digits.slice(1);
else if (digits.startsWith("4") && digits.length === 9) to = "61" + digits;
else {
  console.error(`Could not normalise "${phone}" to an AU mobile.`);
  process.exit(1);
}

console.log(`Sending test SMS:`);
console.log(`  From:    ${from}`);
console.log(`  To:      ${to}`);
console.log(`  Message: "Mankin SMS test, ignore." (29 chars)`);
console.log();

const resp = await fetch("https://api.smsbroadcast.com.au/api-adv.php", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    username,
    password,
    to,
    from,
    message: "Mankin SMS test, ignore.",
    maxsplit: "1",
    ref: "smoke-test",
  }),
});

const text = (await resp.text()).trim();
console.log(`HTTP ${resp.status}`);
console.log(`Response body:`);
console.log(text);
console.log();

if (text.startsWith("OK:")) {
  console.log("PASS: message queued. Check your phone in 5-30 seconds.");
} else if (text.startsWith("BAD:")) {
  console.log("FAIL: SMS Broadcast rejected the send.");
  console.log("Common causes:");
  console.log("  - Wrong username or password");
  console.log("  - No credit on the account (top up at smsbroadcast.com.au)");
  console.log("  - Sender ID not yet approved (will fall back to short code, but should still send)");
  console.log("  - Number formatting issue");
} else {
  console.log("FAIL: unexpected response. Paste this output to Claude for help.");
}
