const { test, expect } = require('@playwright/test');

const card = (page, id = 'a') => page.getByTestId(`swipe-card-fixture-${id}`);
const current = (page) => page.getByTestId('harness-current');
const count = (page) => page.getByTestId('harness-count');

async function translation(locator) {
  return locator.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
}

async function drag(page, distance, vertical = 0, release = true) {
  const active = (await current(page).innerText()).replace('fixture-', '');
  const bounds = await card(page, active).boundingBox();
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + 180;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + distance * 0.3, y + vertical * 0.3, { steps: 3 });
  await page.mouse.move(x + distance, y + vertical, { steps: 8 });
  if (release) await page.mouse.up();
}

async function centered(page, id = 'a') {
  // The gesture stays locked until the spring actually finishes. An approximate
  // center can precede its completion callback by several animation frames.
  await expect.poll(async () => (await translation(card(page, id))).x).toBe(0);
}

async function startPreviewGeometryProbe(page, id) {
  const text = id === 'b' ? {
    title: 'Read a new chapter',
    description: 'Settle into a comfortable chair with your favourite book.',
    step: 'Pick a book.',
  } : {
    title: 'Stretch and reset',
    description: 'Make room for an easy stretch and a few slow breaths.',
    step: 'Find a comfortable space.',
  };
  await page.evaluate(({ id, text }) => {
    const layer = document.querySelector(`[data-testid="swipe-card-fixture-${id}"]`);
    const content = layer.firstElementChild;
    const findText = (value) => [...layer.querySelectorAll('*')].find(
      (element) => element.children.length === 0 && element.textContent === value,
    );
    const nodes = { layer, content, ...Object.fromEntries(
      Object.entries({ ...text, hint: 'Tap for details →' }).map(([name, value]) => [name, findText(value)]),
    ) };
    const probe = { nodes, samples: [], running: true };
    window.__geometryProbe = probe;
    function sample() {
      probe.samples.push(Object.fromEntries(Object.entries(nodes).map(([name, node]) => {
        if (!node) return [name, null];
        const { x, y, width, height } = node.getBoundingClientRect();
        return [name, { x, y, width, height, connected: node.isConnected }];
      })));
      if (probe.running) requestAnimationFrame(sample);
    }
    sample();
  }, { id, text });
}

async function expectStablePreviewGeometry(page, id) {
  const result = await page.evaluate(async (id) => {
    // Include frames after React promotes the preview, so a final-layout jump
    // cannot hide between the exit animation and the next assertion.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const probe = window.__geometryProbe;
    probe.running = false;
    return {
      sameLayer: document.querySelector(`[data-testid="swipe-card-fixture-${id}"]`) === probe.nodes.layer,
      sameContent: probe.nodes.layer.firstElementChild === probe.nodes.content,
      samples: probe.samples,
    };
  }, id);
  expect(result.sameLayer).toBe(true);
  expect(result.sameContent).toBe(true);
  expect(result.samples.length).toBeGreaterThan(2);
  for (const name of ['layer', 'content', 'title', 'description', 'step', 'hint']) {
    const baseline = result.samples[0][name];
    expect(baseline, `${name} must already be laid out in the preview`).not.toBeNull();
    expect(result.samples.every((sample) => sample[name]?.connected), `${name} must remain mounted`).toBe(true);
    for (const dimension of ['x', 'y', 'width', 'height']) {
      const drift = Math.max(...result.samples.map((sample) => Math.abs(sample[name][dimension] - baseline[dimension])));
      expect(drift, `${name}.${dimension} must stay fixed through promotion`).toBeLessThanOrEqual(0.25);
    }
  }
}

async function flipToBack(page) {
  await card(page).getByText('Tap for details →', { exact: true }).click();
  const back = card(page).locator('[style*="perspective"]').last();
  await expect(back).toHaveCSS('opacity', '1');
  await expect.poll(() => back.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m13)).toBe(0);
  return back;
}

test.beforeEach(async ({ page }) => {
  page.__unexpectedErrors = [];
  page.__externalRequests = [];
  page.on('pageerror', (error) => page.__unexpectedErrors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    page.__externalRequests.push(url.origin);
    return route.abort();
  });
  await page.goto('/', { timeout: 120_000 });
  await expect(current(page)).toHaveText('fixture-a');
  await expect(card(page)).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(page.__unexpectedErrors).toEqual([]);
  expect(page.__externalRequests).toEqual([]);
});

test('button exit retains the outgoing card and promotes the mounted preview without fading', async ({ page }, testInfo) => {
  const immediate = await page.evaluate(() => {
    const outgoing = document.querySelector('[data-testid="swipe-card-fixture-a"]');
    const preview = document.querySelector('[data-testid="swipe-card-fixture-b"]');
    const content = preview.firstElementChild;
    window.__probe = { outgoing, preview, content, samples: [], running: true };
    function sample() {
      const probe = window.__probe;
      probe.samples.push({ connected: preview.isConnected, sameContent: preview.firstElementChild === content,
        opacity: Number(getComputedStyle(content).opacity), layerOpacity: Number(getComputedStyle(preview).opacity) });
      if (probe.running) requestAnimationFrame(sample);
    }
    sample();
    document.querySelector('[data-testid="swipe-left"]').click();
    return { count: document.querySelector('[data-testid="harness-count"]').textContent, connected: outgoing.isConnected };
  });
  expect(immediate).toEqual({ count: '0', connected: true });
  await expect(current(page)).toHaveText('fixture-b');
  const result = await page.evaluate(() => {
    const probe = window.__probe;
    probe.running = false;
    return {
      sameLayer: document.querySelector('[data-testid="swipe-card-fixture-b"]') === probe.preview,
      sameContent: probe.preview.firstElementChild === probe.content,
      outgoingRemoved: !probe.outgoing.isConnected,
      samples: probe.samples,
    };
  });
  expect(result.sameLayer).toBe(true);
  expect(result.sameContent).toBe(true);
  expect(result.outgoingRemoved).toBe(true);
  expect(result.samples.length).toBeGreaterThan(2);
  expect(result.samples.every((sample) => sample.connected && sample.sameContent && sample.opacity === 1 && sample.layerOpacity === 1)).toBe(true);
  await expect(card(page, 'b')).toHaveCSS('pointer-events', 'auto');
  await expect(count(page)).toHaveText('1');
  await page.screenshot({ path: testInfo.outputPath('promoted-preview.png') });
  await page.getByTestId('swipe-right').click();
  await expect(current(page)).toHaveText('fixture-c');
  await expect(page.getByTestId('harness-events')).toHaveText(JSON.stringify([
    { direction: 'left', id: 'fixture-a' }, { direction: 'right', id: 'fixture-b' },
  ]));
});

test('left and right pointer gestures follow the finger and commit one card each', async ({ page }, testInfo) => {
  await drag(page, 140, 15, false);
  expect((await translation(card(page))).x).toBeGreaterThan(100);
  await expect(count(page)).toHaveText('0');
  await page.screenshot({ path: testInfo.outputPath('swipe-mid-drag.png') });
  await page.mouse.up();
  await expect(current(page)).toHaveText('fixture-b');
  await drag(page, -140, -10);
  await expect(current(page)).toHaveText('fixture-c');
  await expect(page.getByTestId('harness-events')).toHaveText(JSON.stringify([
    { direction: 'right', id: 'fixture-a' }, { direction: 'left', id: 'fixture-b' },
  ]));
});

for (const width of [430, 360]) {
  for (const input of ['button', 'pointer']) {
    test(`${input} promotion preserves preview size and content layout at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 });
      // Consecutive promotions cover the newly inserted preview too: it must
      // start with the same final layout as the preview mounted at page load.
      for (const [id, direction] of [['b', 'left'], ['c', 'right']]) {
        await startPreviewGeometryProbe(page, id);
        if (input === 'button') await page.getByTestId(`swipe-${direction}`).click();
        else await drag(page, direction === 'left' ? -140 : 140);
        await expect(current(page)).toHaveText(`fixture-${id}`);
        await expectStablePreviewGeometry(page, id);
      }
      await expect(count(page)).toHaveText('2');
    });
  }
}

test('an abandoned short drag springs back without an action or remount', async ({ page }) => {
  const original = await card(page).elementHandle();
  await drag(page, 20, 3);
  await centered(page);
  await expect(current(page)).toHaveText('fixture-a');
  await expect(count(page)).toHaveText('0');
  expect(await original.evaluate((element) => element === document.querySelector('[data-testid="swipe-card-fixture-a"]'))).toBe(true);
  await page.getByTestId('swipe-right').click();
  await expect(current(page)).toHaveText('fixture-b');
});

test('a flipped outgoing card retains the same back face while it exits', async ({ page }, testInfo) => {
  const back = await flipToBack(page);
  const original = await back.elementHandle();
  await drag(page, -140, 0, false);
  expect(await original.evaluate((element) => element.isConnected && getComputedStyle(element).opacity === '1')).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('flipped-card-drag.png') });
  await page.mouse.up();
  await expect(current(page)).toHaveText('fixture-b');
});

test('vertical intent leaves the card centered and detail content can scroll', async ({ page }, testInfo) => {
  const back = await flipToBack(page);
  await expect(card(page)).toHaveCSS('touch-action', 'pan-y');
  const scrollView = await back.evaluateHandle((element) => [...element.querySelectorAll('*')].find(
    (node) => node.scrollHeight > node.clientHeight + 20 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY),
  ));
  expect(await scrollView.evaluate((element) => Boolean(element))).toBe(true);
  const bounds = await scrollView.asElement().boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 180);
  await expect.poll(() => scrollView.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(count(page)).toHaveText('0');
  await page.screenshot({ path: testInfo.outputPath('scrolled-card-back.png') });
  // Desktop mouse dragging does not scroll like a touch gesture, but vertical
  // intent must still never start a horizontal card swipe.
  await drag(page, 18, -130);
  await centered(page);
  await expect(count(page)).toHaveText('0');
});

test('rapid buttons cannot duplicate a pending asynchronous action', async ({ page }) => {
  await page.getByTestId('callback-mode').selectOption('deferred');
  await page.evaluate(() => {
    const left = document.querySelector('[data-testid="swipe-left"]');
    const right = document.querySelector('[data-testid="swipe-right"]');
    for (let i = 0; i < 12; i += 1) { left.click(); right.click(); }
  });
  await expect(page.getByTestId('harness-pending')).toHaveText('true');
  await expect(count(page)).toHaveText('1');
  await page.getByTestId('swipe-right').click();
  await page.getByTestId('swipe-left').click();
  await expect(count(page)).toHaveText('1');
  await page.getByTestId('resolve-advance').click();
  await expect(current(page)).toHaveText('fixture-b');
  await page.getByTestId('callback-mode').selectOption('advance');
  await page.getByTestId('swipe-right').click();
  await expect(current(page)).toHaveText('fixture-c');
  await expect(count(page)).toHaveText('2');
});

for (const outcome of ['hold', 'reject']) {
  test(`asynchronous ${outcome} restores the same card and unlocks the next swipe`, async ({ page }) => {
    const original = await card(page).elementHandle();
    await page.getByTestId('callback-mode').selectOption('deferred');
    await page.getByTestId('swipe-right').click();
    await expect(page.getByTestId('harness-pending')).toHaveText('true');
    await page.getByTestId(outcome === 'hold' ? 'resolve-hold' : 'reject').click();
    await centered(page);
    expect(await original.evaluate((element) => element.isConnected)).toBe(true);
    await expect(current(page)).toHaveText('fixture-a');
    await expect(count(page)).toHaveText('1');
    await page.getByTestId('callback-mode').selectOption('advance');
    // Recovery remains locked until the spring has settled.
    await expect.poll(async () => {
      await page.getByTestId('swipe-left').click();
      return current(page).innerText();
    }).toBe('fixture-b');
    await expect(count(page)).toHaveText('2');
  });
}

test('a synchronous callback failure restores the card', async ({ page }) => {
  await page.getByTestId('callback-mode').selectOption('throw');
  await page.getByTestId('swipe-right').click();
  await expect(count(page)).toHaveText('1');
  await centered(page);
  await expect(current(page)).toHaveText('fixture-a');
});

test('disabled buttons and gestures do nothing, including a disable during exit', async ({ page }) => {
  await page.getByTestId('disabled-toggle').check();
  await page.getByTestId('swipe-right').click();
  await drag(page, 140);
  await centered(page);
  await expect(count(page)).toHaveText('0');
  await page.getByTestId('disabled-toggle').uncheck();
  await page.evaluate(() => {
    document.querySelector('[data-testid="swipe-left"]').click();
    document.querySelector('[data-testid="disabled-toggle"]').click();
  });
  await page.waitForTimeout(300);
  await centered(page);
  await expect(count(page)).toHaveText('0');
  await expect(current(page)).toHaveText('fixture-a');
});

test('the deck exhausts cleanly and undo returns a usable last card', async ({ page }) => {
  const height = await page.getByTestId('swipe-deck').evaluate((element) => element.getBoundingClientRect().height);
  for (const next of ['fixture-b', 'fixture-c', 'empty']) {
    await page.getByTestId('swipe-left').click();
    await expect(current(page)).toHaveText(next);
  }
  await expect(page.locator('[data-testid^="swipe-card-"]')).toHaveCount(0);
  await page.getByTestId('swipe-left').click();
  await page.getByTestId('swipe-right').click();
  await expect(count(page)).toHaveText('3');
  expect(await page.getByTestId('swipe-deck').evaluate((element) => element.getBoundingClientRect().height)).toBe(height);
  await page.getByTestId('undo').click();
  await expect(current(page)).toHaveText('fixture-c');
  await centered(page, 'c');
  await page.getByTestId('swipe-right').click();
  await expect(current(page)).toHaveText('empty');
  await expect(count(page)).toHaveText('4');
});

test.describe('touchscreen', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('a horizontal touch swipe moves the actual card and promotes its preview', async ({ page }) => {
    const bounds = await card(page).boundingBox();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + 160;
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const delta of [15, 35, 60, 90, 120, 145]) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: x + delta, y: y + delta * 0.05 }],
      });
      await page.waitForTimeout(20);
    }
    expect((await translation(card(page))).x).toBeGreaterThan(100);
    await expect(count(page)).toHaveText('0');
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(current(page)).toHaveText('fixture-b');
    await expect(page.getByTestId('harness-events')).toHaveText(JSON.stringify([
      { direction: 'right', id: 'fixture-a' },
    ]));
  });
});
