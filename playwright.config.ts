import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry"
  },
  webServer: {
    command: "cmd /c npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] }
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
