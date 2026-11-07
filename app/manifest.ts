import type { MetadataRoute } from "next";

/**
 * What makes Mailflow installable: as an app on Windows and Mac (from
 * Chrome or Edge, or Safari's Add to Dock) and on a phone's home screen
 * (Android, and iPhone through Safari's Add to Home Screen). It opens
 * in its own window at the dashboard.
 *
 * The icons are drawn from public/icons/mailflow-icon.svg, the Mailflow
 * mark on navy, kept inside the maskable safe zone. To change them,
 * edit the SVG and re-render the 512, 192 and 180 (apple-touch) PNGs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    /* A stable identity, so changing start_url later does not make
       browsers think it is a different app and install it twice. */
    id: "/marketing",
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
      { src: "/icons/mailflow-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
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
        name: "Automations",
        short_name: "Automations",
        description: "Sequences and how far each client has got",
        url: "/marketing/automations",
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
