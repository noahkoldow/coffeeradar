const { test } = require('node:test');
const assert = require('node:assert/strict');
const { accountTokenForUid, evaluateVerifiedSubscription, lookupAppleEnvironment } = require('../lib/premiumPolicy');
const now = 1_800_000_000_000;
const transaction = (overrides = {}) => ({ productId: 'premium', appAccountToken: accountTokenForUid('alice'),
  originalTransactionId: '12345678', expiresDate: now + 60_000, ...overrides });
const evaluate = (data, status = 1, grace) => evaluateVerifiedSubscription(data, status, 'alice', 'premium', now, grace);

test('server account binding is stable, UUID-shaped and distinct per Bits user', () => {
  assert.match(accountTokenForUid('alice'), /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-a[\da-f]{3}-[\da-f]{12}$/);
  assert.equal(accountTokenForUid('alice'), accountTokenForUid('alice'));
  assert.notEqual(accountTokenForUid('alice'), accountTokenForUid('bob'));
});
test('verified active subscription grants only the configured product to its bound account', () => {
  assert.equal(evaluate(transaction()).active, true);
  assert.throws(() => evaluate(transaction({ productId: 'other' })), /wrong-product/);
  assert.throws(() => evaluate(transaction({ appAccountToken: accountTokenForUid('bob') })), /wrong-account/);
  assert.throws(() => evaluate(transaction({ appAccountToken: undefined })), /wrong-account/);
  assert.throws(() => evaluate(transaction({ originalTransactionId: undefined })), /missing-transaction/);
});
test('revoked, expired, retry and unknown subscription states do not grant Premium', () => {
  for (const status of [2, 3, 5, '1', 99]) assert.equal(evaluate(transaction(), status).active, false);
  assert.equal(evaluate(transaction({ expiresDate: now })).active, false);
  assert.equal(evaluate(transaction({ expiresDate: Infinity })).active, false);
  assert.equal(evaluate(transaction({ revocationDate: now - 1 })).active, false);
});
test('Apple-verified grace period has a bounded entitlement expiration', () => {
  const result = evaluate(transaction({ expiresDate: now - 1 }), 4, now + 5_000);
  assert.equal(result.active, true);
  assert.equal(result.expiresAtMs, now + 5_000);
  assert.equal(evaluate(transaction({ expiresDate: now - 1 }), 4, now - 1).active, false);
});
test('missing TestFlight environment safely retries Sandbox only after store not-found', async () => {
  const calls = [];
  const result = await lookupAppleEnvironment(null, async (environment) => {
    calls.push(environment);
    if (environment === 'Production') throw { apiError: 4040010 };
    return { valid: true };
  });
  assert.deepEqual(calls, ['Production', 'Sandbox']);
  assert.equal(result.environment, 'Sandbox');
});
test('store authorization, quota and network failures never trigger environment fallback', async () => {
  for (const error of [{ apiError: 401 }, { apiError: 429 }, new Error('offline')]) {
    let calls = 0;
    await assert.rejects(lookupAppleEnvironment(null, async () => { calls++; throw error; }));
    assert.equal(calls, 1);
  }
});
test('forged signed store transaction is rejected by the real Apple verifier', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { SignedDataVerifier, Environment } = require('@apple/app-store-server-library');
  const verifier = new SignedDataVerifier([fs.readFileSync(path.join(__dirname, '../certs/AppleRootCA-G3.cer'))], false, Environment.SANDBOX, 'com.bitsapp.404');
  await assert.rejects(verifier.verifyAndDecodeTransaction('eyJhbGciOiJub25lIn0.eyJwcm9kdWN0SWQiOiJwcmVtaXVtIn0.'));
});
