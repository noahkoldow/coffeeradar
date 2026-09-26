const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const artifacts = path.join(__dirname, '../artifacts/session-map');
fs.mkdirSync(artifacts, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const checks = [];
    for (const width of [320, 390]) for (const language of ['en', 'de']) for (const scenario of ['empty', 'list', 'few', 'many']) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`http://localhost:8101/?language=${language}&scenario=${scenario}`, { timeout: 120000 });
      const button = page.getByTestId('session-map-button');
      await button.waitFor({ timeout: 120000 });
      const count = scenario === 'empty' ? 0 : scenario === 'few' ? 3 : scenario === 'list' ? 8 : 17;
      assert.equal(await button.textContent(), `🗺️${count || ''}`);
      await button.click();
      assert.equal(await button.textContent(), '🗺️', 'opening marks new entries as read');
      const panel = page.getByTestId('session-map-panel');
      assert.equal((await panel.boundingBox()).height, 420);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow');
      assert.equal(await page.locator('[data-testid^="session-map-row-"]').count(), count);
      await page.screenshot({ path: path.join(artifacts, `${width}-${language}-${scenario}.png`) });
      if (count) {
        const target = page.getByTestId(`session-map-row-idea-${count - 1}`);
        await target.scrollIntoViewIfNeeded();
        await target.click();
        assert.equal(await page.getByTestId('selection').textContent(), `idea-${count - 1}`);
        await page.getByRole('button', { name: language === 'de' ? 'Zurück zur Karte' : 'Back to map', exact: true }).click();
        assert.equal(await page.getByTestId('selection').textContent(), 'map');
      }
      if (scenario === 'few') {
        const pins = page.locator('[data-testid^="session-map-pin-"]');
        assert.ok(await pins.count() > 0);
        const modes = await page.getByTestId('session-map-list').textContent();
        for (const mode of ['🚶', '🚌', '🚗']) assert.ok(modes.includes(mode));
        await pins.first().click();
        if (await page.getByTestId('selection').textContent() === 'map') await page.locator('[data-testid^="session-map-row-"]').first().click();
        assert.match(await page.getByTestId('selection').textContent(), /^idea-/);
      }
      if (scenario === 'many') {
        const cluster = page.getByRole('button', { name: language === 'de' ? /\d+ Aktivitäten an diesem Ort/ : /\d+ activities in this area/ }).first();
        await cluster.click();
        const visibleCount = await page.locator('[data-testid^="session-map-row-"]').count();
        assert.ok(visibleCount > 1 && visibleCount < count);
        await page.getByRole('button', { name: language === 'de' ? 'Alle Ideen anzeigen' : 'Show all ideas', exact: true }).click();
        assert.equal(await page.locator('[data-testid^="session-map-row-"]').count(), count);
      }
      checks.push(`${width}px ${language} ${scenario}`);
    }
    await page.goto('http://localhost:8101/?language=de&scenario=many&theme=dark&badge=large');
    await page.getByTestId('session-map-button').waitFor();
    assert.equal(await page.getByTestId('session-map-button').textContent(), '🗺️99+');
    await page.getByTestId('session-map-button').click();
    await page.screenshot({ path: path.join(artifacts, '390-de-dark.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, pageErrors: errors, artifacts }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
