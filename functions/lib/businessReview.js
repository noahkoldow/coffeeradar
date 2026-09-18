"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewBusinessListing = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const authorization_1 = require("./authorization");
const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max;
function validListing(b) {
    return !!b && text(b.name, 2, 120) && text(b.description, 20, 1000)
        && ['gym', 'cafe', 'restaurant', 'studio', 'venue', 'other'].includes(b.type)
        && text(b.place?.name, 1, 120) && text(b.place?.address, 1, 500)
        && Number.isFinite(b.place?.lat) && Math.abs(b.place.lat) <= 90
        && Number.isFinite(b.place?.lng) && Math.abs(b.place.lng) <= 180
        && Array.isArray(b.targetTags) && b.targetTags.length > 0 && b.targetTags.length <= 8
        && b.targetTags.every((tag) => text(tag, 1, 60));
}
/** Canonical publication and legacy review state are committed together. */
exports.reviewBusinessListing = (0, https_1.onCall)({ timeoutSeconds: 30 }, async (request) => {
    if (!(0, authorization_1.hasAdminRole)(request.auth))
        throw new https_1.HttpsError('permission-denied', 'Administrator role required.');
    const { submissionId, action, note } = request.data || {};
    if (!text(submissionId, 1, 150) || submissionId.includes('/') || !['approve', 'reject'].includes(action))
        throw new https_1.HttpsError('invalid-argument', 'A valid submission and decision are required.');
    if ((note != null && !text(note, 1, 1000)) || (action === 'reject' && !text(note, 1, 1000)))
        throw new https_1.HttpsError('invalid-argument', 'Provide a reason, up to 1000 characters.');
    const db = admin.firestore();
    const ref = db.collection('business_submissions').doc(submissionId);
    // Never use a caller-supplied nested business ID as a publication destination.
    const businessRef = db.collection('businesses').doc(submissionId);
    return db.runTransaction(async (transaction) => {
        const [snapshot, existing] = await Promise.all([transaction.get(ref), transaction.get(businessRef)]);
        if (!snapshot.exists)
            throw new https_1.HttpsError('not-found', 'Submission not found.');
        const submission = snapshot.data();
        const status = action === 'approve' ? 'approved' : 'rejected';
        if (submission.status === status)
            return { status, businessId: action === 'approve' ? submissionId : null, alreadyReviewed: true };
        if (submission.status !== 'pending')
            throw new https_1.HttpsError('failed-precondition', 'This submission was already reviewed. Refresh the queue.');
        if (!text(submission.submittedBy, 1, 128))
            throw new https_1.HttpsError('failed-precondition', 'Submission has no valid owner.');
        const now = new Date().toISOString();
        if (action === 'approve') {
            const b = submission.business;
            if (!validListing(b))
                throw new https_1.HttpsError('failed-precondition', 'This legacy submission is incomplete. Ask its owner to submit complete details.');
            if (existing.exists && (existing.data()?.ownerId !== submission.submittedBy || existing.data()?.sourceSubmissionId !== submissionId))
                throw new https_1.HttpsError('already-exists', 'This business ID is already in use. No existing business was changed.');
            const profile = {
                id: submissionId, userId: submission.submittedBy, ownerId: submission.submittedBy,
                businessName: b.name.trim(), name: b.name.trim(), type: b.type,
                category: ['gym', 'cafe', 'restaurant'].includes(b.type) ? b.type : 'other',
                description: b.description.trim(), email: '', website: '',
                location: { address: b.place.address.trim(), lat: b.place.lat, lng: b.place.lng, city: '', country: '' },
                place: { name: b.place.name.trim(), address: b.place.address.trim(), lat: b.place.lat, lng: b.place.lng },
                targetTags: b.targetTags.map((tag) => tag.trim()),
                verificationStatus: 'verified', isVerified: true, verificationBadge: true,
                teamMembers: { [submission.submittedBy]: 'owner' }, sourceSubmissionId: submissionId,
                createdAt: existing.data()?.createdAt || now, updatedAt: now, onboardingComplete: false,
                metrics: existing.data()?.metrics || { impressions: 0, clicks: 0, conversions: 0 },
            };
            // Preserve submitted contact facts; missing location/contact details stay missing.
            if (text(b.phone, 1, 80))
                profile.phone = b.phone.trim();
            if (text(b.website, 1, 2048) && /^https:\/\//i.test(b.website))
                profile.website = b.website.trim();
            transaction.set(businessRef, profile, { merge: true });
        }
        transaction.update(ref, { status, reviewedAt: now, reviewerId: request.auth.uid, reviewNote: note?.trim() || null, updatedAt: now });
        return { status, businessId: action === 'approve' ? submissionId : null, alreadyReviewed: false };
    });
});
