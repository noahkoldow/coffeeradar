import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'crypto';
import { hasAdminRole } from './authorization';
import { campaignWindow, mayManageBusiness, canRedeemCampaign, redemptionLimits } from './campaignPolicy';

const options = { timeoutSeconds: 30, maxInstances: 10 };
const id = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,140}$/.test(value)) throw new HttpsError('invalid-argument', `${label} is invalid.`);
  return value;
};
const caller = (request: any): string => {
  if (!request.auth || request.auth.token?.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Sign in to use business offers.');
  return request.auth.uid;
};
const reject = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const eligible = (campaign: any, business: any) => {
  try { return canRedeemCampaign(campaign, business); } catch (error) { return reject((error as Error).message); }
};
const compact = (value: any): any => JSON.parse(JSON.stringify(value));
const emptyMetrics = () => ({ impressions: 0, clicks: 0, engagements: 0, activityStarts: 0,
  calendarAdds: 0, conversions: 0, uniqueUsers: 0, ctr: 0, conversionRate: 0, lastUpdated: new Date().toISOString() });
export const campaignTupleKey = (businessId: string, campaignId: string): string => `v2_${createHash('sha256').update(JSON.stringify([businessId, campaignId])).digest('hex')}`;
const queueKey = (businessId: string, campaignId: string) => `campaign_${campaignTupleKey(businessId, campaignId)}`;
const totalsRef = (db: admin.firestore.Firestore, businessId: string, campaignId: string) => db.doc(`campaign_redemption_totals/${campaignTupleKey(businessId, campaignId)}`);
async function readTotal(tx: admin.firestore.Transaction, db: admin.firestore.Firestore, businessId: string, campaignId: string) {
  const current = await tx.get(totalsRef(db, businessId, campaignId));
  if (current.exists) return Number(current.data()?.redeemed) || 0;
  const legacy = await tx.get(db.doc(`campaign_redemption_totals/${businessId}_${campaignId}`));
  if (!legacy.exists) return 0;
  const data = legacy.data()!;
  if ((!businessId.includes('_') && !campaignId.includes('_')) || (data.businessId === businessId && data.campaignId === campaignId)) return Number(data.redeemed) || 0;
  if (!data.redeemed) return 0;
  // Old ambiguous aggregates cannot safely be assigned to either campaign.
  reject('A legacy redemption total needs operator reconciliation before this offer can continue. Existing uses were preserved.');
}

function normalizedTargeting(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('invalid-argument', 'Targeting must be an object.');
  const result = { ...value };
  for (const key of ['moods', 'weatherConditions', 'interests', 'requiredTags']) {
    const tags = result[key] ?? [];
    if (!Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 80)) throw new HttpsError('invalid-argument', 'Audience tags must be a short list of text values.');
    result[key] = [...new Set(tags.map(tag => tag.trim()))];
  }
  if (result.requiredDurationMin != null && (!Number.isInteger(result.requiredDurationMin) || result.requiredDurationMin < 1 || result.requiredDurationMin > 1440)) throw new HttpsError('invalid-argument', 'Duration must be between 1 and 1440 minutes.');
  if (!Array.isArray(result.locations ?? [])) throw new HttpsError('invalid-argument', 'Campaign locations must be a list.');
  const locations = [...(result.locations ?? []), ...(result.targetLocation ? [result.targetLocation] : [])];
  if (locations.some(location => !location || !Number.isFinite(location.lat) || Math.abs(location.lat) > 90 || !Number.isFinite(location.lng) || Math.abs(location.lng) > 180 || !Number.isFinite(location.radiusKm) || location.radiusKm <= 0 || location.radiusKm > 200)) throw new HttpsError('invalid-argument', 'Campaign location or radius is invalid.');
  if (result.isOneTimeEvent && !Number.isFinite(Date.parse(result.oneTimeStartAt))) throw new HttpsError('invalid-argument', 'Event date and time are required.');
  if (result.isOneTimeEvent && !Number.isInteger(result.requiredDurationMin)) throw new HttpsError('invalid-argument', 'A one-time event needs its actual duration in minutes.');
  if (result.timeWindows != null && (!Array.isArray(result.timeWindows) || result.timeWindows.length > 21 || result.timeWindows.some((window: any) => !window || typeof window.day !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(window.startTime) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(window.endTime) || window.startTime >= window.endTime))) throw new HttpsError('invalid-argument', 'Campaign time windows are invalid.');
  return result;
}

export const saveBusinessCampaign = onCall(options, async (request) => {
  const uid = caller(request);
  const businessId = id(request.data?.businessId, 'Business');
  const campaignId = id(request.data?.campaignId, 'Campaign');
  const input = request.data?.campaign || {};
  const now = new Date().toISOString();
  const fields: any = {};
  for (const key of ['title', 'hook', 'description', 'cta', 'category', 'media', 'mediaUrl', 'logoUrl', 'emojis', 'retrieveOffer', 'targeting', 'dateRange', 'redemptionRules', 'budget']) {
    if (input[key] !== undefined) fields[key] = input[key];
  }
  for (const [key, maximum] of [['title', 120], ['hook', 240], ['description', 2500]] as const) {
    if (typeof fields[key] !== 'string' || !fields[key].trim() || fields[key].length > maximum) throw new HttpsError('invalid-argument', `${key} is required and must be at most ${maximum} characters.`);
    fields[key] = fields[key].trim();
  }
  if (!fields.cta || typeof fields.cta.text !== 'string' || !fields.cta.text.trim() || !['url', 'phone', 'calendar', 'location'].includes(fields.cta.action) || typeof fields.cta.value !== 'string') throw new HttpsError('invalid-argument', 'A valid call to action is required.');
  if (fields.cta.action === 'url' && !/^https:\/\//i.test(fields.cta.value)) throw new HttpsError('invalid-argument', 'Campaign links must use HTTPS.');
  if (typeof fields.category !== 'string' || !fields.targeting || typeof fields.targeting !== 'object') throw new HttpsError('invalid-argument', 'Category and targeting are required.');
  fields.targeting = normalizedTargeting(fields.targeting);
  if (JSON.stringify(fields).length > 30_000) throw new HttpsError('invalid-argument', 'Campaign content is too large.');
  try { campaignWindow({ ...fields, status: 'active' }, Date.parse(fields.dateRange?.startDate)); redemptionLimits(fields); }
  catch (error) { throw new HttpsError('invalid-argument', (error as Error).message); }
  const db = admin.firestore();
  const businessRef = db.doc(`businesses/${businessId}`);
  const campaignRef = businessRef.collection('campaigns').doc(campaignId);
  const creationFingerprint = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  return db.runTransaction(async tx => {
    const [business, current] = await Promise.all([tx.get(businessRef), tx.get(campaignRef)]);
    if (!mayManageBusiness(business.data(), uid)) throw new HttpsError('permission-denied', 'Business owner or editor access required.');
    if (current.exists && current.data()?.status !== 'draft') reject('Only draft campaigns can be edited. Pause an active campaign and submit a new draft for content changes.');
    if (current.exists && input.expectedUpdatedAt == null) {
      if (current.data()?.creationFingerprint === creationFingerprint) return current.data();
      throw new HttpsError('aborted', 'This draft already exists. Reload it before editing.');
    }
    if (current.exists && input.expectedUpdatedAt != null && input.expectedUpdatedAt !== current.data()?.updatedAt) {
      throw new HttpsError('aborted', 'Another editor changed this campaign. Reload it before saving your changes.');
    }
    const campaign = compact({ ...current.data(), ...fields, id: campaignId, businessId, status: 'draft',
      creationFingerprint: current.data()?.creationFingerprint || creationFingerprint,
      metrics: { ...emptyMetrics(), ...current.data()?.metrics },
      createdBy: current.data()?.createdBy || uid, createdAt: current.data()?.createdAt || now, updatedAt: now });
    tx.set(campaignRef, campaign);
    return campaign;
  });
});

export const submitBusinessCampaign = onCall(options, async request => {
  const uid = caller(request);
  const businessId = id(request.data?.businessId, 'Business');
  const campaignId = id(request.data?.campaignId, 'Campaign');
  const db = admin.firestore();
  const businessRef = db.doc(`businesses/${businessId}`);
  const campaignRef = businessRef.collection('campaigns').doc(campaignId);
  const queueId = queueKey(businessId, campaignId);
  await db.runTransaction(async tx => {
    const legacyQueueRef = db.doc(`approval_queue/campaign_${businessId}_${campaignId}`);
    const [business, campaign, legacyQueue, currentQueue] = await Promise.all([tx.get(businessRef), tx.get(campaignRef), tx.get(legacyQueueRef), tx.get(db.doc(`approval_queue/${queueId}`))]);
    if (!mayManageBusiness(business.data(), uid)) throw new HttpsError('permission-denied', 'Business editor access required.');
    if (!campaign.exists) throw new HttpsError('not-found', 'Campaign not found.');
    if (campaign.data()?.status === 'pending_approval' && currentQueue.exists) return;
    if (!['draft', 'pending_approval'].includes(campaign.data()?.status)) reject('Only a draft can be submitted for review.');
    const submittedAt = Timestamp.now();
    const approval = { kind: 'campaign', businessId, campaignId, status: 'pending', submittedAt, submittedBy: uid };
    tx.update(campaignRef, { status: 'pending_approval', updatedAt: new Date().toISOString() });
    tx.set(campaignRef.collection('approvals').doc('current'), approval);
    tx.set(db.collection('approval_queue').doc(queueId), approval);
    if (legacyQueue.exists && legacyQueue.data()?.businessId === businessId && legacyQueue.data()?.campaignId === campaignId) tx.set(legacyQueueRef, { status: 'superseded', replacementId: queueId }, { merge: true });
  });
  return { success: true };
});

export const reviewBusinessCampaign = onCall(options, async request => {
  const uid = caller(request);
  if (!hasAdminRole(request.auth)) throw new HttpsError('permission-denied', 'Administrator role required.');
  const businessId = id(request.data?.businessId, 'Business');
  const campaignId = id(request.data?.campaignId, 'Campaign');
  const approve = request.data?.decision === 'approve';
  if (!approve && request.data?.decision !== 'reject') throw new HttpsError('invalid-argument', 'Review decision required.');
  const reason = String(request.data?.reason || '').slice(0, 1000);
  const db = admin.firestore();
  const businessRef = db.doc(`businesses/${businessId}`);
  const campaignRef = businessRef.collection('campaigns').doc(campaignId);
  await db.runTransaction(async tx => {
    const legacyQueueRef = db.doc(`approval_queue/campaign_${businessId}_${campaignId}`);
    const [business, campaign, legacyQueue] = await Promise.all([tx.get(businessRef), tx.get(campaignRef), tx.get(legacyQueueRef)]);
    if (!campaign.exists || campaign.data()?.status !== 'pending_approval') reject('This campaign is no longer pending review.');
    if (approve && business.data()?.verificationStatus !== 'verified') reject('Verify the business before approving its campaign.');
    if (approve && Date.parse(campaign.data()?.dateRange?.endDate) <= Date.now()) reject('This campaign has already expired.');
    const now = new Date().toISOString();
    const review = { status: approve ? 'approved' : 'rejected', reviewedBy: uid, reviewedAt: now, reason };
    tx.update(campaignRef, { status: approve ? 'active' : 'draft', updatedAt: now, approvalNotes: reason });
    tx.set(campaignRef.collection('approvals').doc('current'), review, { merge: true });
    tx.set(db.doc(`approval_queue/${queueKey(businessId, campaignId)}`), { kind: 'campaign', businessId, campaignId, ...review }, { merge: true });
    if (legacyQueue.exists && legacyQueue.data()?.businessId === businessId && legacyQueue.data()?.campaignId === campaignId) tx.set(legacyQueueRef, review, { merge: true });
  });
  return { success: true };
});

export const getBusinessCampaignById = onCall(options, async request => {
  const uid = caller(request);
  const campaignId = id(request.data?.campaignId, 'Campaign');
  const db = admin.firestore();
  const matches = await db.collectionGroup('campaigns').where('id', '==', campaignId).limit(2).get();
  if (matches.empty) return null;
  if (matches.size !== 1) throw new HttpsError('failed-precondition', 'Ambiguous legacy campaign identifier.');
  const campaign = matches.docs[0].data();
  const business = (await db.doc(`businesses/${id(campaign.businessId, 'Business')}`).get()).data();
  if (hasAdminRole(request.auth) || business?.ownerId === uid || business?.teamMembers?.[uid]) return compact(campaign);
  try {
    if (business?.verificationStatus !== 'verified') throw new Error();
    campaignWindow(campaign);
    return compact(campaign);
  } catch { throw new HttpsError('permission-denied', 'Campaign is not available.'); }
});

/** Exported handlers permit isolated Firestore-emulator transaction tests without HTTP impersonation. */
export async function issueCampaignVoucherForUser(uid: string, businessId: string, campaignId: string) {
  id(businessId, 'Business'); id(campaignId, 'Campaign');
  const db = admin.firestore();
  const key = createHash('sha256').update(`${businessId}:${campaignId}:${uid}`).digest('hex');
  const counterRef = db.doc(`campaign_redemption_users/${key}`);
  const campaignRef = db.doc(`businesses/${businessId}/campaigns/${campaignId}`);
  return db.runTransaction(async tx => {
    const [business, campaign, counter, total] = await Promise.all([tx.get(db.doc(`businesses/${businessId}`)), tx.get(campaignRef), tx.get(counterRef), readTotal(tx, db, businessId, campaignId)]);
    const limits = eligible(campaign.data(), business.data());
    const user = counter.data() || {};
    if ((user.redeemed || 0) >= limits.perUser) reject('You have already used this offer.');
    if ((total || 0) >= limits.total) reject('This offer has reached its redemption limit.');
    if (user.openVoucherId) {
      const existing = await tx.get(db.doc(`campaign_vouchers/${user.openVoucherId}`));
      if (existing.exists && !existing.data()?.redeemed && existing.data()!.expiresAtMs > Date.now()) return existing.data();
    }
    const voucherId = randomUUID();
    const voucher = { id: voucherId, businessId, campaignId, userId: uid, counterKey: key, redeemed: false,
      issuedAtMs: Date.now(), expiresAtMs: Math.min(limits.end, Date.now() + 24 * 60 * 60 * 1000) };
    tx.set(db.doc(`campaign_vouchers/${voucherId}`), voucher);
    tx.set(counterRef, { ...user, openVoucherId: voucherId });
    return voucher;
  });
}

export async function redeemCampaignVoucherForUser(uid: string, voucherId: string) {
  id(voucherId, 'Voucher');
  const db = admin.firestore();
  const voucherRef = db.doc(`campaign_vouchers/${voucherId}`);
  return db.runTransaction(async tx => {
    const voucherSnap = await tx.get(voucherRef);
    if (!voucherSnap.exists) throw new HttpsError('not-found', 'Voucher not found.');
    const voucher = voucherSnap.data()!;
    const campaignRef = db.doc(`businesses/${voucher.businessId}/campaigns/${voucher.campaignId}`);
    const counterRef = db.doc(`campaign_redemption_users/${voucher.counterKey}`);
    const totalRef = totalsRef(db, voucher.businessId, voucher.campaignId);
    const [business, campaign, user, total] = await Promise.all([tx.get(db.doc(`businesses/${voucher.businessId}`)), tx.get(campaignRef), tx.get(counterRef), readTotal(tx, db, voucher.businessId, voucher.campaignId)]);
    if (!mayManageBusiness(business.data(), uid)) throw new HttpsError('permission-denied', 'Only this business can redeem its vouchers.');
    if (voucher.redeemed) return { success: true, alreadyRedeemed: true };
    const limits = eligible(campaign.data(), business.data());
    if (voucher.expiresAtMs <= Date.now()) reject('This voucher has expired.');
    if ((user.data()?.redeemed || 0) >= limits.perUser) reject('The customer has reached this offer limit.');
    if ((total || 0) >= limits.total) reject('This offer has reached its redemption limit.');
    const redeemedAtMs = Date.now();
    tx.update(voucherRef, { redeemed: true, redeemedAtMs, redeemedBy: uid });
    tx.set(counterRef, { redeemed: (user.data()?.redeemed || 0) + 1, openVoucherId: null });
    tx.set(totalRef, { businessId: voucher.businessId, campaignId: voucher.campaignId, redeemed: (total || 0) + 1 });
    tx.update(campaignRef, { metrics: { ...emptyMetrics(), ...campaign.data()?.metrics,
      conversions: (Number(campaign.data()?.metrics?.conversions) || 0) + 1,
      lastUpdated: new Date(redeemedAtMs).toISOString() } });
    tx.set(db.doc(`conversions/campaign_${voucherId}`), { businessId: voucher.businessId, campaignId: voucher.campaignId,
      voucherId, userId: voucher.userId, redeemedAtMs, source: 'business_campaign' });
    return { success: true, alreadyRedeemed: false };
  });
}

export const issueCampaignVoucher = onCall(options, request => issueCampaignVoucherForUser(caller(request), request.data?.businessId, request.data?.campaignId));
export const redeemCampaignVoucher = onCall(options, request => redeemCampaignVoucherForUser(caller(request), request.data?.voucherId));

/** Recheck cached business facts before calendar or local commitment writes. */
export const validateBusinessCampaignCommitment = onCall(options, async request => {
  caller(request);
  const businessId = id(request.data?.businessId, 'Business'), campaignId = id(request.data?.campaignId, 'Campaign');
  const start = Date.parse(request.data?.startAt), end = Date.parse(request.data?.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < Date.now() - 1000 || end <= start) throw new HttpsError('invalid-argument', 'Choose an activity time in the future.');
  const db = admin.firestore();
  const [business, snapshot] = await Promise.all([db.doc(`businesses/${businessId}`).get(), db.doc(`businesses/${businessId}/campaigns/${campaignId}`).get()]);
  const campaign = snapshot.data();
  if (business.data()?.verificationStatus !== 'verified' || !campaign) reject('This business campaign is no longer available.');
  try { campaignWindow(campaign, start); } catch { reject('This campaign is not available at the chosen time.'); }
  const duration = campaign!.targeting?.requiredDurationMin ?? 60;
  if (end > Date.parse(campaign!.dateRange.endDate) || end - start !== duration * 60000) reject('The full activity must fit within the campaign dates and its listed duration.');
  if (campaign!.targeting?.isOneTimeEvent && start !== Date.parse(campaign!.targeting.oneTimeStartAt)) reject('This event has a fixed published start time.');
  return { available: true };
});

/** Optional first-party reporting, capped at one view/choice per signed-in person/day. */
export const recordBusinessCampaignEvent = onCall(options, async request => {
  const uid = caller(request);
  const businessId = id(request.data?.businessId, 'Business');
  const campaignId = id(request.data?.campaignId, 'Campaign');
  const kind = request.data?.kind;
  if (!['impression', 'selection'].includes(kind) || request.data?.consent !== true) throw new HttpsError('invalid-argument', 'A permitted reporting event is required.');
  const db = admin.firestore();
  const day = new Date().toISOString().slice(0, 10);
  const marker = createHash('sha256').update(JSON.stringify([uid, businessId, campaignId, day, kind])).digest('hex');
  const markerRef = db.doc(`campaign_event_dedup/${marker}`);
  const campaignRef = db.doc(`businesses/${businessId}/campaigns/${campaignId}`);
  return db.runTransaction(async tx => {
    const [business, campaign, previous, consent] = await Promise.all([tx.get(db.doc(`businesses/${businessId}`)), tx.get(campaignRef), tx.get(markerRef), tx.get(db.doc(`users/${uid}/privacy/campaignReporting`))]);
    if (consent.data()?.enabled !== true) throw new HttpsError('permission-denied', 'Campaign reporting is not enabled for this account.');
    if (previous.exists) return { recorded: false };
    if (business.data()?.verificationStatus !== 'verified') reject('This business is not verified.');
    try { campaignWindow(campaign.data()); } catch { reject('This campaign is not available.'); }
    const metrics = { ...emptyMetrics(), ...campaign.data()?.metrics };
    if (kind === 'impression') metrics.impressions = (Number(metrics.impressions) || 0) + 1;
    else metrics.clicks = (Number(metrics.clicks) || 0) + 1;
    metrics.ctr = metrics.impressions ? metrics.clicks / metrics.impressions : 0;
    metrics.lastUpdated = new Date().toISOString();
    tx.update(campaignRef, { metrics, reportingVersion: 'daily-consented-v1' });
    // No raw UID, title, interests, location or calendar data is retained here.
    tx.create(markerRef, { expiresAt: Timestamp.fromMillis(Date.now() + 30 * 86400000) });
    return { recorded: true };
  });
});
