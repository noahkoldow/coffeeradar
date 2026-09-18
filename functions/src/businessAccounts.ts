import { createHash } from 'crypto';
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { hasAdminRole } from './authorization';

const options = { timeoutSeconds: 30, maxInstances: 10 };
const text = (value: unknown, maximum: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const createBusinessAccount = onCall(options, async request => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Sign in before creating a business account.');
  const uid = request.auth.uid, input = request.data?.profile;
  if (!input || !text(input.businessName, 120) || !text(input.email, 254) || !input.email.includes('@')
    || !['restaurant','cafe','gym','wellness','entertainment','retail','services','events','tourism','other'].includes(input.category)
    || !text(input.location?.address, 500) || !text(input.location?.city, 120) || !text(input.location?.country, 100)
    || input.location?.coordinatesSource !== 'owner-confirmed'
    || !Number.isFinite(input.location.lat) || Math.abs(input.location.lat) > 90
    || !Number.isFinite(input.location.lng) || Math.abs(input.location.lng) > 180) {
    throw new HttpsError('invalid-argument', 'Provide business details and explicitly confirm its actual map coordinates.');
  }
  const content: any = { businessName: input.businessName.trim(), category: input.category, email: input.email.trim(),
    location: { address: input.location.address.trim(), city: input.location.city.trim(), country: input.location.country.trim(),
      lat: input.location.lat, lng: input.location.lng, coordinatesSource: 'owner-confirmed' }, website: '' };
  for (const key of ['description','phone','website']) {
    if (input[key] != null && typeof input[key] !== 'string') throw new HttpsError('invalid-argument', `${key} must be text.`);
    if (typeof input[key] === 'string') content[key] = input[key].trim().slice(0, key === 'description' ? 2500 : 2048);
  }
  // Device-local image picker URIs are not published as remotely accessible assets.
  if (input.logo?.url && /^https:\/\//i.test(input.logo.url)) content.logo = { url: input.logo.url, uploadedAt: new Date().toISOString() };
  if (input.socialLinks && typeof input.socialLinks === 'object') {
    content.socialLinks = Object.fromEntries(['instagram','facebook'].filter(key => typeof input.socialLinks[key] === 'string').map(key => [key, input.socialLinks[key].trim().slice(0,2048)]));
  }
  const contentHash = fingerprint(content), db = admin.firestore(), ref = db.doc(`businesses/${uid}`), reviewRef = db.doc(`business_verification_requests/${uid}`);
  return db.runTransaction(async transaction => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      if (existing.data()?.ownerId === uid && existing.data()?.creationFingerprint === contentHash) return existing.data();
      throw new HttpsError('already-exists', 'A business account already exists. Open its settings instead.');
    }
    const now = new Date().toISOString();
    const profile = { ...content, id: uid, userId: uid, ownerId: uid, teamMembers: { [uid]: 'owner' },
      verificationStatus: 'pending', verificationBadge: false, verificationRequestId: uid,
      creationFingerprint: contentHash, createdAt: now, updatedAt: now, onboardingComplete: true };
    transaction.create(ref, profile);
    transaction.create(reviewRef, { businessId: uid, requestedBy: uid, status: 'pending', submittedAt: now, expectedUpdatedAt: now });
    return profile;
  });
});

/** Shared by the claim-authenticated callable and an explicitly approved IAM operator tool. */
export async function reviewBusinessAccountRecord(businessId: string, decision: 'approve' | 'reject', expectedUpdatedAt: string, reviewer: string, note: string) {
  if (!/^[A-Za-z0-9_-]{1,140}$/.test(businessId) || !['approve','reject'].includes(decision) || !text(expectedUpdatedAt, 100) || !text(note, 1000)) throw new HttpsError('invalid-argument', 'Provide the business, decision, exact reviewed revision and review evidence/reason.');
  const db = admin.firestore(), ref = db.doc(`businesses/${businessId}`), requestRef = db.doc(`business_verification_requests/${businessId}`);
  return db.runTransaction(async transaction => {
    const [snapshot, requestSnapshot] = await Promise.all([transaction.get(ref), transaction.get(requestRef)]);
    if (!snapshot.exists || !requestSnapshot.exists) throw new HttpsError('not-found', 'Business review request not found.');
    const business = snapshot.data()!, previous = requestSnapshot.data()!, status = decision === 'approve' ? 'verified' : 'rejected';
    if (business.verificationStatus === status && previous.status === status && previous.reviewedRevision === expectedUpdatedAt) return { status, alreadyReviewed: true };
    if (business.verificationStatus !== 'pending' || previous.status !== 'pending' || business.updatedAt !== expectedUpdatedAt) throw new HttpsError('failed-precondition', 'This account changed or was reviewed. Inspect the current record before deciding.');
    if (decision === 'approve' && (business.location?.coordinatesSource !== 'owner-confirmed' || !Number.isFinite(business.location?.lat) || Math.abs(business.location.lat) > 90 || !Number.isFinite(business.location?.lng) || Math.abs(business.location.lng) > 180)) throw new HttpsError('failed-precondition', 'Confirm the actual business coordinates before approval.');
    const now = new Date().toISOString();
    transaction.update(ref, { verificationStatus: status, verificationBadge: decision === 'approve', verificationNote: note.trim(), updatedAt: now });
    transaction.update(requestRef, { status, reviewedBy: reviewer, reviewedRevision: expectedUpdatedAt, reviewedAt: now, note: note.trim() });
    return { status, alreadyReviewed: false };
  });
}

export const reviewBusinessAccount = onCall(options, request => {
  if (!hasAdminRole(request.auth)) throw new HttpsError('permission-denied', 'Administrator role required.');
  return reviewBusinessAccountRecord(request.data?.businessId, request.data?.decision, request.data?.expectedUpdatedAt, request.auth!.uid, request.data?.note);
});
