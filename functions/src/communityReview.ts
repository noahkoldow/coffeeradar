import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { hasAdminRole } from './authorization';

const text = (value: unknown, maximum: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
function validContent(data: any): boolean {
  const list = (value: unknown, maximum: number) => value === undefined || (Array.isArray(value) && value.length <= maximum && value.every(tag => text(tag, 80)));
  if (!data || !text(data.title, 160) || !text(data.hook, 300) || !text(data.description, 3000)
      || !['AT_HOME', 'GO_OUT', 'EVENT'].includes(data.type) || !Number.isFinite(data.durationMin) || data.durationMin < 1 || data.durationMin > 1440
      || !list(data.tags, 10) || !list(data.emojis, 6)) return false;
  for (const field of ['cta', 'imageUrl', 'submittedByEmail']) if (data[field] != null && typeof data[field] !== 'string') return false;
  if (data.place != null && (typeof data.place !== 'object' || !text(data.place.name, 200)
      || (data.place.address != null && typeof data.place.address !== 'string')
      || (data.place.lat != null && (!Number.isFinite(data.place.lat) || Math.abs(data.place.lat) > 90))
      || (data.place.lng != null && (!Number.isFinite(data.place.lng) || Math.abs(data.place.lng) > 180)))) return false;
  if (data.timeOfDay != null && !['any', 'morning', 'afternoon', 'evening'].includes(data.timeOfDay)) return false;
  if (data.event != null && (typeof data.event !== 'object' || Array.isArray(data.event) || !text(data.event.startAt, 80) || !text(data.event.venue, 200) || !text(data.event.ticketUrl, 2048) || Object.values(data.event).some(value => value != null && typeof value !== 'string'))) return false;
  return true;
}
function contentSnapshot(data: any): string {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(['title', 'hook', 'description', 'type', 'durationMin', 'cta', 'tags', 'emojis', 'place', 'event', 'imageUrl', 'timeOfDay'].map(key => canonical(data[key] ?? null)));
}

/** Reviewer identity is authenticated; publication and queue decision are indivisible. */
export const moderateCommunityIdea = onCall({ timeoutSeconds: 30 }, async request => {
  if (!hasAdminRole(request.auth)) throw new HttpsError('permission-denied', 'Administrator role required.');
  const { ideaId, action, note, expectedContent } = request.data || {};
  if (typeof ideaId !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(ideaId) || !['approve', 'reject'].includes(action)) throw new HttpsError('invalid-argument', 'Valid idea and decision required.');
  if ((note != null && !text(note, 1000)) || (action === 'reject' && !text(note, 1000))) throw new HttpsError('invalid-argument', 'A rejection reason of up to 1000 characters is required.');
  const db = admin.firestore();
  const ideaRef = db.doc(`community_ideas/${ideaId}`);
  const queueRef = db.doc(`approval_queue/${ideaId}`);
  return db.runTransaction(async transaction => {
    const [idea, queue] = await Promise.all([transaction.get(ideaRef), transaction.get(queueRef)]);
    if (!idea.exists) throw new HttpsError('not-found', 'Submission not found.');
    const data = idea.data()!;
    if (queue.exists && (queue.data()?.kind !== 'community_idea' || queue.data()?.ideaId !== ideaId)) throw new HttpsError('failed-precondition', 'Review queue identifier conflict. No records changed.');
    const status = action === 'approve' ? 'approved' : 'rejected';
    if (data.status === status && queue.data()?.status === status) return { status, alreadyReviewed: true };
    if (data.status !== 'pending') throw new HttpsError('failed-precondition', 'This idea was already reviewed. Refresh the queue.');
    if (typeof expectedContent !== 'string' || expectedContent !== contentSnapshot(data)) throw new HttpsError('aborted', 'This submission changed after you opened it. Reload the queue and review its current content.');
    if (action === 'approve' && !validContent(data)) throw new HttpsError('failed-precondition', 'Incomplete legacy idea. Ask its owner to correct the content before publication.');
    const review = { status, reviewedAt: new Date().toISOString(), reviewerId: request.auth!.uid, reviewNote: note?.trim() || null };
    transaction.update(ideaRef, review);
    transaction.set(queueRef, { kind: 'community_idea', ideaId, ...review }, { merge: true });
    return { status, alreadyReviewed: false };
  });
});
