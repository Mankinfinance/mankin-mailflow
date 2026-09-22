import type { MetadataRoute } from "next";

/**
 * PWA manifest for the whole LoanFlow shell. Brokers install from
 * /dashboard and get the broker pipeline as a standalone app on their
 * phone or tablet home screen; customers install from /portal/[token]
 * and get the same shell tuned to their journey by start_url. iOS
 * Safari + Android Chrome both honour this file.
 *
 * To regenerate icons for sharper home-screen art, run any icon-gen
 * tool on /public/brand/mankin-logo.png and write 192/512 PNGs under
 * /public/icons/ - then update the icons array below.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mailflow",
    short_name: "Mailflow",
    description: "Email marketing for Mankin Finance, run off the loan book.",
    /* Mailflow has no /dashboard — that is LoanFlow's route, and an
       installed app opening it landed on a 404. */
    start_url: "/marketing",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fbf7f0",
    theme_color: "#1c2566",
    lang: "en-AU",
    categories: ["business", "productivity", "finance"],
    icons: [
      // Crisp square PNGs (proper app-icon art on a navy tile). 512 doubles
      // as the maskable icon since it's full-bleed with the mark inside the
      // safe zone. The SVG gives infinite sharpness where browsers accept it.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    /* Both of LoanFlow's shortcuts pointed at routes this app does not
       have, so a long-press on the installed icon offered two dead
       ends. These are the two screens worth a shortcut here. */
    shortcuts: [
      {
        name: "Campaigns",
        short_name: "Campaigns",
        description: "What has gone out, and what is drafted",
        url: "/marketing/campaigns",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Subscribers",
        short_name: "Contacts",
        description: "The contact list and who is engaged",
        url: "/marketing/subscribers",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
