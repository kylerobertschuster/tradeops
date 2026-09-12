import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // The tested modules are pure and server-side; no DOM needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
