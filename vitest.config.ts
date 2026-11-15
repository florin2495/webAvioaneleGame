import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Only needed so tests of server modules (src/lib/server/*.test.ts) resolve the "@/..." imports of tsconfig.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
