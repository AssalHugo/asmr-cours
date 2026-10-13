import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Le Chromium de Playwright ne décode pas l'AAC : pour tester la lecture réelle, on prend
 * un navigateur installé (Chrome en CI, sinon le premier trouvé, ou E2E_BROWSER_PATH).
 */
const installed = [
  process.env.E2E_BROWSER_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/brave-browser",
  "/usr/bin/chromium",
].find((path) => path && existsSync(path));

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    storageState: "test-results/session.json",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    ...devices["Pixel 7"],
    launchOptions: {
      ...(installed ? { executablePath: installed } : {}),
      args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
    },
  },
  // Build de production : c'est là que le service worker est actif.
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      APP_ENV: "dev",
      AI_MODE: "mock",
      JOBS_MODE: "inline",
      STORAGE_MODE: "local",
      APP_URL: BASE_URL,
    },
  },
});
