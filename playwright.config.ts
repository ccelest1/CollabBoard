import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 3000",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
