import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  timeout: 45000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5180',
    headless: true,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js --configLoader native --host 127.0.0.1 --port 5180 --strictPort',
    url: 'http://127.0.0.1:5180',
    env: { VITE_ROUTING_URL: 'https://router.project-osrm.org' },
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
})
