import { defineConfig } from "@playwright/test";

/**
 * Smoke tests for an already running seeded stack. CI provisions and starts
 * that stack before invoking Playwright; local runs should do the same.
 * Default target is the local dashboard; override with PLAYWRIGHT_BASE_URL.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
});
