import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { hasAdminRole } from './authorization';

const text = (value: unknown, min: number, max: number): value is string => typeof value === 'string' && value.trim().length >= min && value.length <= max;
function validListing(b: any): boolean {
  return !!b && text(b.name, 2, 120) && text(b.description, 20, 1000)
    && ['gym', 'cafe', 'restaurant', 'studio', 'venue', 'other'].includes(b.type)
    && text(b.place?.name, 1, 120) && text(b.place?.address, 1, 500)
    && Number.isFinite(b.place?.lat) && Math.abs(b.place.lat) <= 90
    && Number.isFinite(b.place?.lng) && Math.abs(b.place.lng) <= 180
    && Array.isArray(b.targetTags) && b.targetTags.length > 0 && b.targetTags.length <= 8
    && b.targetTags.every((tag: unknown) => text(tag, 1, 60));
}

/** Canonical publication and legacy review state are committed together. */
export const reviewBusinessListing = onCall({ timeoutSeconds: 30 }, async request => {
  if (!hasAdminRole(request.auth)) throw new HttpsError('permission-denied', 'Administrator role required.');
  const { submissionId, action, note } = request.data || {};
  if (!text(submissionId, 1, 150) || submissionId.includes('/') || !['approve', 'reject'].includes(action)) throw new HttpsError('invalid-argument', 'A valid submission and decision are required.');
  if ((note != null && !text(note, 1, 1000)) || (action === 'reject' && !text(note, 1, 1000))) throw new HttpsError('invalid-argument', 'Provide a reason, up to 1000 characters.');
  const db = admin.firestore();
  const ref = db.collection('business_submissions').doc(submissionId);
  // Never use a caller-supplied nested business ID as a publication destination.
  const businessRef = db.collection('businesses').doc(submissionId);
  return db.runTransaction(async transaction => {
    const [snapshot, existing] = await Promise.all([transaction.get(ref), transaction.get(businessRef)]);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Submission not found.');
    const submission = snapshot.data()!;
    const status = action === 'approve' ? 'approved' : 'rejected';
    if (submission.status === status) return { status, businessId: action === 'approve' ? submissionId : null, alreadyReviewed: true };
    if (submission.status !== 'pending') throw new HttpsError('failed-precondition', 'This submission was already reviewed. Refresh the queue.');
    if (!text(submission.submittedBy, 1, 128)) throw new HttpsError('failed-precondition', 'Submission has no valid owner.');
    const now = new Date().toISOString();
    if (action === 'approve') {
      const b = submission.business;
      if (!validListing(b)) throw new HttpsError('failed-precondition', 'This legacy submission is incomplete. Ask its owner to submit complete details.');
      if (existing.exists && (existing.data()?.ownerId !== submission.submittedBy || existing.data()?.sourceSubmissionId !== submissionId)) throw new HttpsError('already-exists', 'This business ID is already in use. No existing business was changed.');
      const profile: Record<string, unknown> = {
        id: submissionId, userId: submission.submittedBy, ownerId: submission.submittedBy,
        businessName: b.name.trim(), name: b.name.trim(), type: b.type,
        category: ['gym', 'cafe', 'restaurant'].includes(b.type) ? b.type : 'other',
        description: b.description.trim(), email: '', website: '',
        location: { address: b.place.address.trim(), lat: b.place.lat, lng: b.place.lng, city: '', country: '' },
        place: { name: b.place.name.trim(), address: b.place.address.trim(), lat: b.place.lat, lng: b.place.lng },
        targetTags: b.targetTags.map((tag: string) => tag.trim()),
        verificationStatus: 'verified', isVerified: true, verificationBadge: true,
        teamMembers: { [submission.submittedBy]: 'owner' }, sourceSubmissionId: submissionId,
        createdAt: existing.data()?.createdAt || now, updatedAt: now, onboardingComplete: false,
        metrics: existing.data()?.metrics || { impressions: 0, clicks: 0, conversions: 0 },
      };
      // Preserve submitted contact facts; missing location/contact details stay missing.
      if (text(b.phone, 1, 80)) profile.phone = b.phone.trim();
      if (text(b.website, 1, 2048) && /^https:\/\//i.test(b.website)) profile.website = b.website.trim();
      transaction.set(businessRef, profile, { merge: true });
    }
    transaction.update(ref, { status, reviewedAt: now, reviewerId: request.auth!.uid, reviewNote: note?.trim() || null, updatedAt: now });
    return { status, businessId: action === 'approve' ? submissionId : null, alreadyReviewed: false };
  });
});
