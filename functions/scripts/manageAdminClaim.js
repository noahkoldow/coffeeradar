/* Read only: node scripts/manageAdminClaim.js inspect --email bitsapp.admin@gmail.com
 * Grant/revoke after owner approval: add --apply to a set/unset command.
 * Uses Application Default Credentials; never put credentials in source or chat. */
const admin = require('firebase-admin');
async function main() {
  const args = process.argv.slice(2);
  const action = args[0];
  const emailIndex = args.indexOf('--email');
  const email = emailIndex >= 0 ? args[emailIndex + 1] : undefined;
  const uid = email ? undefined : args[1];
  if (!['inspect', 'set', 'unset'].includes(action) || (!email && !uid)) {
    throw new Error('Usage: manageAdminClaim.js <inspect|set|unset> <uid>|--email <email> [--apply]');
  }
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'coffeeradar-415f2' });
  const auth = admin.auth();
  const user = email ? await auth.getUserByEmail(email) : await auth.getUser(uid);
  console.log(JSON.stringify({ uid: user.uid, email: user.email, emailVerified: user.emailVerified,
    disabled: user.disabled, admin: user.customClaims?.admin === true }));
  if (action === 'inspect') return;
  if (!args.includes('--apply')) {
    console.log(`Dry run: would ${action} admin claim. Re-run with --apply after approval.`);
    return;
  }
  if (action === 'set' && (user.disabled || !user.emailVerified)) {
    throw new Error('Grant requires an enabled identity with verified email.');
  }
  const claims = { ...user.customClaims };
  if (action === 'set') claims.admin = true;
  else delete claims.admin;
  await auth.setCustomUserClaims(user.uid, claims);
  console.log('Claim updated. Reopen Profile or Settings to force a token refresh. Already-issued ID tokens retain their claims until refresh or expiry; this is not instantaneous revocation.');
}
main().catch((error) => {
  console.error('Admin operation failed:', error.code || error.message);
  process.exitCode = 1;
});
