import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 *
 * Supports ISO 27001 Annex A.8.20 (network security) and A.8.21
 * (security of network services). Documented as Implemented in
 * docs/iso27001/statement-of-applicability.md.
 *
 * Content Security Policy was removed after it broke Microsoft Entra
 * sign-in redirects + Next.js hydration. A proper CSP needs per-build
 * nonces threaded through every server-rendered page; deferred to
 * Wave 2. The simpler protective headers below cover the
 * highest-value risks without breaking anything.
 */
const securityHeaders = [
  {
    // HSTS - tells browsers to only ever connect via HTTPS for the next
    // two years, including subdomains.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    // Stops the browser from MIME-sniffing - guards against the
    // SharePoint upload + audit log download flows being misinterpreted.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Drops the most-sensitive permissions on the broker dashboard
    // surface. Camera stays unrestricted because the customer portal
    // uses it for photo uploads on mobile.
    key: "Permissions-Policy",
    value:
      "geolocation=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
  },
  {
    // No PII leaks to third-party referers when a broker clicks an
    // external link.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /* Customer portal uploads travel through a server action, and Next
         caps server-action request bodies at 1 MB by default. That is
         smaller than a typical phone photo of a payslip, so customers hit
         "Body exceeded 1 MB limit" - which surfaces as a thrown error, not
         our {ok:false} result, so the portal showed a bare "Upload failed".

         4 MB is the practical ceiling: Vercel rejects request bodies over
         4.5 MB at the platform level, before Next sees them, so raising
         this any further would not help on production. Files larger than
         this are rejected client-side with a message that says so, rather
         than failing mysteriously. Lifting the ceiling properly means
         uploading straight to SharePoint from the browser instead of
         through a server action. */
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
