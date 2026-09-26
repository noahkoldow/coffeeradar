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
    for (const [width, height] of [[375, 667], [390, 844]]) for (const language of ['en', 'de']) for (const mode of ['deck', 'map', 'loading', 'empty']) {
      await page.setViewportSize({ width, height });
      await page.goto(`http://localhost:8101/?layout=1&mode=${mode}&language=${language}&scenario=many`, { timeout: 120000 });
      const mapButton = page.getByTestId('session-map-button');
      await mapButton.waitFor({ timeout: 120000 });
      await mapButton.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow');
      if (mode === 'deck' || mode === 'map') {
        const heart = page.getByText('♡', { exact: true });
        const buttonBounds = await mapButton.boundingBox(), heartBounds = await heart.boundingBox();
        assert.ok(Math.abs(buttonBounds.x + buttonBounds.width / 2 - heartBounds.x - heartBounds.width / 2) < 2, 'map button sits directly above heart');
        assert.ok(buttonBounds.y + buttonBounds.height <= heartBounds.y, 'map and heart do not overlap');
        if (mode === 'map') {
          const panel = await page.getByTestId('session-map-panel').boundingBox();
          assert.ok(panel.y + panel.height <= buttonBounds.y, 'map panel does not overlap map button');
          assert.equal(panel.height, 420);
        }
      }
      await page.screenshot({ path: path.join(artifacts, `layout-${width}-${height}-${language}-${mode}.png`) });
      if (mode !== 'map') {
        await mapButton.click();
        await page.getByTestId('session-map-panel').waitFor();
        assert.equal(await mapButton.textContent(), '🗺️');
      }
      checks.push(`${width}x${height} ${language} ${mode}`);
    }
    await page.goto('http://localhost:8101/?layout=1&mode=deck&language=en&scenario=many');
    await page.getByTestId('session-map-button').waitFor();
    const title = page.getByText('1. Find your next favourite coffee and a little inspiration', { exact: true }).first();
    const cardTitle = await title.boundingBox();
    await page.mouse.move(cardTitle.x + cardTitle.width * .7, cardTitle.y + cardTitle.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardTitle.x + cardTitle.width * .7 - 180, cardTitle.y + cardTitle.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__layoutSwipes === 1);
    await page.goto('http://localhost:8101/?layout=1&mode=map&language=en&scenario=many&credits=0');
    await page.getByTestId('session-map-panel').waitFor();
    await page.getByTestId('session-map-row-idea-0').click();
    await page.getByRole('button', { name: '← Back to map', exact: true }).click();
    await page.getByTestId('session-map-panel').waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, horizontalSwipeInsideScrollView: true, creditsZeroMapBrowsing: true, pageErrors: errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
