const test = require('node:test');
const assert = require('node:assert/strict');
const { hasAdminRole } = require('../lib/authorization');

test('only a boolean server-assigned admin claim authorizes an administrator', () => {
  assert.equal(hasAdminRole({ token: { admin: true } }), true);
  for (const auth of [undefined, null, {}, { token: {} }, { token: { admin: false } },
    { token: { admin: 'true' } }, { token: { email: 'bitsapp.admin@gmail.com' } },
    { token: { admin: 1, email: 'bitsapp.admin@gmail.com' } }]) {
    assert.equal(hasAdminRole(auth), false);
  }
});
test('a forged caller payload cannot change role resolution', () => {
  const forgedRequest = { auth: { token: { email: 'ordinary@example.test' } },
    data: { admin: true, email: 'bitsapp.admin@gmail.com', uid: 'admin' } };
  assert.equal(hasAdminRole(forgedRequest.auth), false);
});
