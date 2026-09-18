import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

/** A durable request, not a claim that every account-linked record was erased. */
export const requestAccountDeletion = onCall({ region: 'us-central1' }, async request => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to request deletion of your own account.');
  }
  if (request.data?.confirmation !== 'DELETE') throw new HttpsError('invalid-argument', 'Explicit confirmation is required.');
  const uid = request.auth.uid;
  if (request.data?.expectedUserId !== uid) throw new HttpsError('permission-denied', 'The signed-in account changed. Review the request again.');
  const db = admin.firestore();
  return db.runTransaction(async transaction => {
    const ref = db.collection('account_deletion_requests').doc(uid);
    const existing = await transaction.get(ref);
    if (existing.exists) return { status: existing.get('status'), alreadyRequested: true };
    transaction.create(ref, { userId: uid, status: 'requested', requestedAt: FieldValue.serverTimestamp() });
    return { status: 'requested', alreadyRequested: false };
  });
});
