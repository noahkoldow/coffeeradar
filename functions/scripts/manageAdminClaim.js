/*
Usage:
  node scripts/manageAdminClaim.js set <uid>
  node scripts/manageAdminClaim.js unset <uid>

Requirements:
  - Run from functions folder where firebase-admin is installed
  - GOOGLE_APPLICATION_CREDENTIALS points to a service account JSON
*/

const admin = require('firebase-admin');

async function main() {
  const [, , action, uid] = process.argv;

  if (!action || !uid || !['set', 'unset'].includes(action)) {
    console.error('Usage: node scripts/manageAdminClaim.js <set|unset> <uid>');
    process.exit(1);
  }

  admin.initializeApp();
  const auth = admin.auth();

  const user = await auth.getUser(uid);
  const currentClaims = user.customClaims || {};

  if (action === 'set') {
    await auth.setCustomUserClaims(uid, { ...currentClaims, admin: true });
    console.log(`Admin claim set for uid=${uid}`);
  } else {
    const { admin: _removed, ...rest } = currentClaims;
    await auth.setCustomUserClaims(uid, rest);
    console.log(`Admin claim removed for uid=${uid}`);
  }

  console.log('User must re-authenticate to receive updated token claims.');
}

main().catch((err) => {
  console.error('Failed to update admin claim:', err?.message || err);
  process.exit(1);
});
