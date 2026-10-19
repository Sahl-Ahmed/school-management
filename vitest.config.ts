import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.{mjs,ts}"],
    // Each suite boots its own in-process Postgres and applies 19 migrations.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // PGlite is a single connection per instance; running suites in parallel
    // inside one worker would interleave `set role` calls between tests.
    fileParallelism: false,
  },
});
