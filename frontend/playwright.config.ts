import { defineConfig, devices } from "@playwright/test";

// E2E_BASE_URL points the tests at an app that is already running (a deployed one, or the Docker stack).
// Without it the tests start the dev server themselves.
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4300";

export default defineConfig({
  testDir: "./e2e",
  // A dev server compiles a page on its first visit, which can take a while.
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1 --port 4300",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
