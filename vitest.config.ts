import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // "server-only" throws when imported outside an RSC context.
      // Stub it to a no-op so we can unit-test pure helpers that live
      // inside server-only modules.
      "server-only": path.resolve(__dirname, "./test/server-only-stub.ts"),
      "@/": path.resolve(__dirname, "./") + "/",
    },
  },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    environment: "node",
  },
});
