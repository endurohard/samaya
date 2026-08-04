import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 40_000,
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    // Контур задаётся переменной BASE_URL: локальный стенд по умолчанию,
    // прод — через ssh-туннель (ssh -L 3011:192.168.5.15:3010 iTTEST).
    baseURL: process.env.BASE_URL || 'http://localhost:3010',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        channel: undefined,
      },
    },
  ],
});
