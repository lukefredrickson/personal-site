import { defineConfig } from "vitest/config";

// Rooted at the factory dir so the site tree is never scanned: the repo
// intentionally has no test runner outside `.sandcastle/` (ADR 0028).
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["src/**/*.test.ts"],
  },
});
