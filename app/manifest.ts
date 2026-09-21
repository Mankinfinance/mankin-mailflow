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
    name: "LoanFlow",
    short_name: "LoanFlow",
    description: "Broker pipeline and customer document portal for Mankin Finance.",
    start_url: "/dashboard",
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
      { src: "/icons/loanflow-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      {
        name: "Today's queue",
        short_name: "Today",
        description: "Jump straight to today's work",
        url: "/dashboard/today",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "CX manager",
        short_name: "CX",
        description: "Customer retention and anniversaries",
        url: "/cx",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
