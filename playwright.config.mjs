import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:4174",
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "node tests/e2e/static-server.mjs",
        url: "http://127.0.0.1:4174",
        reuseExistingServer: !process.env.CI,
      },
});
