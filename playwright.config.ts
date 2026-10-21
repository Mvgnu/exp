import { defineConfig, devices } from '@playwright/test';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
export default defineConfig({
  testDir: './test/e2e', timeout: 30000, workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath, args: ['--no-sandbox', '--no-zygote', '--single-process', '--use-gl=angle', '--use-angle=swiftshader'] } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    { command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory sites/workbench/out', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
    { command: 'python3 -m http.server 4174 --bind 127.0.0.1 --directory sites/catalog/out', url: 'http://127.0.0.1:4174', reuseExistingServer: !process.env.CI },
  ],
});
