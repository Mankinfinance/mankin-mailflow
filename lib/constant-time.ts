/**
 * Constant-time string comparison — avoids leaking secret / OTP values via
 * the early-exit timing of `===`/`!==`. Edge- and Node-safe (uses Web
 * Crypto's TextEncoder, no `node:crypto` import). Lengths are compared
 * first, which leaks only the length — acceptable for fixed-length codes
 * and shared secrets.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
