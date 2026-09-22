import { describe, it, expect } from "vitest";
import authConfig from "./auth.config";

/**
 * Which paths a stranger can reach.
 *
 * Every one of these is opened from a customer's inbox or from the
 * firm's public website, by somebody who has no session and never
 * will. A staff sign-in page in front of any of them makes the thing
 * it guards useless: an unsubscribe link that bounces to /login is an
 * unsubscribe link that does not work, and the Spam Act does not
 * accept "they could have signed in".
 *
 * This exists because /s/ was missed when surveys were added — the
 * same mistake the comment above /e/ warns about, made anyway. A list
 * is easier to forget than a test.
 */

type AuthorizedArgs = Parameters<
  NonNullable<NonNullable<typeof authConfig.callbacks>["authorized"]>
>[0];

function reaches(pathname: string, signedIn: boolean): boolean {
  const authorized = authConfig.callbacks!.authorized!;
  return Boolean(
    authorized({
      auth: signedIn ? ({ user: { email: "michael@mankinfinance.com" } } as never) : null,
      request: { nextUrl: { pathname } } as never,
    } as AuthorizedArgs),
  );
}

const PUBLIC = [
  ["/login", "the sign-in page itself, or it redirect-loops"],
  ["/", "the front door"],
  ["/e/u/abc123", "unsubscribe, opened from an inbox months later"],
  ["/e/o/abc123", "the open pixel, loaded by a mail client"],
  ["/e/c/abc123", "a tracked link click"],
  ["/api/e/u/abc123", "one-click unsubscribe, POSTed by Gmail and Yahoo"],
  ["/s/abc123", "a survey response page, opened from an inbox"],
  ["/f/form-1", "a hosted enquiry form, reached by strangers"],
  ["/api/forms/submit", "that form's submit endpoint"],
  ["/p/refinance", "a published landing page"],
  ["/api/pages/1/view", "its view counter"],
  ["/api/files/abc", "an image, fetched by a mail client rendering an email"],
  ["/api/auth/callback/microsoft-entra-id", "the OAuth callback"],
  ["/manifest.webmanifest", "PWA install"],
  ["/icons/icon-192.png", "PWA install"],
] as const;

describe("paths a customer must reach without signing in", () => {
  for (const [pathname, why] of PUBLIC) {
    it(`allows ${pathname} — ${why}`, () => {
      expect(reaches(pathname, false)).toBe(true);
    });
  }
});

describe("paths that must require a session", () => {
  const PRIVATE = [
    "/marketing",
    "/marketing/campaigns",
    "/marketing/subscribers",
    "/marketing/surveys",
    "/marketing/webhooks",
    "/marketing/settings",
    "/no-access",
    /* Reading an uploaded image is public; adding one is not. */
    "/api/files/upload",
  ];

  for (const pathname of PRIVATE) {
    it(`gates ${pathname}`, () => {
      expect(reaches(pathname, false)).toBe(false);
      expect(reaches(pathname, true)).toBe(true);
    });
  }
});

describe("the public list does not over-reach", () => {
  it("does not open a path merely because it starts similarly", () => {
    // "/ση" style near-misses: a prefix check that is too loose turns
    // one public route into a hole under everything beside it.
    expect(reaches("/settings", false)).toBe(false);
    expect(reaches("/subscribers", false)).toBe(false);
    expect(reaches("/employees", false)).toBe(false);
  });
});
