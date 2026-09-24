import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixture, type FixtureHandle } from '../support/fixture';

describe('fixture in a real browser', () => {
  let fixture: FixtureHandle;
  let browser: Browser;

  beforeAll(async () => {
    fixture = await startFixture();
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
    await fixture.stop();
  });

  it('renders the login page', async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${fixture.baseUrl}/login`);

      expect(await page.title()).toContain('Bank Test');
      expect(await page.getByRole('button', { name: 'Sign On' }).isVisible()).toBe(true);
      expect(await page.getByRole('textbox').count()).toBeGreaterThanOrEqual(1);
    } finally {
      await context.close();
    }
  });

  it('shows the error page for an armed server_error', async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await fixture.armFault('server_error');

      const failed = await page.goto(`${fixture.baseUrl}/login`);
      expect(failed?.status()).toBe(500);
      expect(await page.content()).toContain('System Error');

      const recovered = await page.goto(`${fixture.baseUrl}/login`);
      expect(recovered?.status()).toBe(200);
      expect(await page.getByRole('button', { name: 'Sign On' }).isVisible()).toBe(true);
    } finally {
      await context.close();
    }
  });

  it('opens a native alert on the next page for an armed unexpected_dialog', async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const dialogs: string[] = [];
      page.on('dialog', (dialog) => {
        dialogs.push(`${dialog.type()}: ${dialog.message()}`);
        void dialog.dismiss();
      });
      await fixture.armFault('unexpected_dialog');

      await page.goto(`${fixture.baseUrl}/login`);
      await page.goto(`${fixture.baseUrl}/login`);

      expect(dialogs).toEqual(['alert: Your password expires in 3 days.']);
    } finally {
      await context.close();
    }
  });
});
