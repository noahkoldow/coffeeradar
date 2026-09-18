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
exports.reviewBusinessAccount = exports.createBusinessAccount = void 0;
exports.reviewBusinessAccountRecord = reviewBusinessAccountRecord;
const crypto_1 = require("crypto");
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const authorization_1 = require("./authorization");
const options = { timeoutSeconds: 30, maxInstances: 10 };
const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const fingerprint = (value) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(value)).digest('hex');
exports.createBusinessAccount = (0, https_1.onCall)(options, async (request) => {
    if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous')
        throw new https_1.HttpsError('unauthenticated', 'Sign in before creating a business account.');
    const uid = request.auth.uid, input = request.data?.profile;
    if (!input || !text(input.businessName, 120) || !text(input.email, 254) || !input.email.includes('@')
        || !['restaurant', 'cafe', 'gym', 'wellness', 'entertainment', 'retail', 'services', 'events', 'tourism', 'other'].includes(input.category)
        || !text(input.location?.address, 500) || !text(input.location?.city, 120) || !text(input.location?.country, 100)
        || input.location?.coordinatesSource !== 'owner-confirmed'
        || !Number.isFinite(input.location.lat) || Math.abs(input.location.lat) > 90
        || !Number.isFinite(input.location.lng) || Math.abs(input.location.lng) > 180) {
        throw new https_1.HttpsError('invalid-argument', 'Provide business details and explicitly confirm its actual map coordinates.');
    }
    const content = { businessName: input.businessName.trim(), category: input.category, email: input.email.trim(),
        location: { address: input.location.address.trim(), city: input.location.city.trim(), country: input.location.country.trim(),
            lat: input.location.lat, lng: input.location.lng, coordinatesSource: 'owner-confirmed' }, website: '' };
    for (const key of ['description', 'phone', 'website']) {
        if (input[key] != null && typeof input[key] !== 'string')
            throw new https_1.HttpsError('invalid-argument', `${key} must be text.`);
        if (typeof input[key] === 'string')
            content[key] = input[key].trim().slice(0, key === 'description' ? 2500 : 2048);
    }
    // Device-local image picker URIs are not published as remotely accessible assets.
    if (input.logo?.url && /^https:\/\//i.test(input.logo.url))
        content.logo = { url: input.logo.url, uploadedAt: new Date().toISOString() };
    if (input.socialLinks && typeof input.socialLinks === 'object') {
        content.socialLinks = Object.fromEntries(['instagram', 'facebook'].filter(key => typeof input.socialLinks[key] === 'string').map(key => [key, input.socialLinks[key].trim().slice(0, 2048)]));
    }
    const contentHash = fingerprint(content), db = admin.firestore(), ref = db.doc(`businesses/${uid}`), reviewRef = db.doc(`business_verification_requests/${uid}`);
    return db.runTransaction(async (transaction) => {
        const existing = await transaction.get(ref);
        if (existing.exists) {
            if (existing.data()?.ownerId === uid && existing.data()?.creationFingerprint === contentHash)
                return existing.data();
            throw new https_1.HttpsError('already-exists', 'A business account already exists. Open its settings instead.');
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
async function reviewBusinessAccountRecord(businessId, decision, expectedUpdatedAt, reviewer, note) {
    if (!/^[A-Za-z0-9_-]{1,140}$/.test(businessId) || !['approve', 'reject'].includes(decision) || !text(expectedUpdatedAt, 100) || !text(note, 1000))
        throw new https_1.HttpsError('invalid-argument', 'Provide the business, decision, exact reviewed revision and review evidence/reason.');
    const db = admin.firestore(), ref = db.doc(`businesses/${businessId}`), requestRef = db.doc(`business_verification_requests/${businessId}`);
    return db.runTransaction(async (transaction) => {
        const [snapshot, requestSnapshot] = await Promise.all([transaction.get(ref), transaction.get(requestRef)]);
        if (!snapshot.exists || !requestSnapshot.exists)
            throw new https_1.HttpsError('not-found', 'Business review request not found.');
        const business = snapshot.data(), previous = requestSnapshot.data(), status = decision === 'approve' ? 'verified' : 'rejected';
        if (business.verificationStatus === status && previous.status === status && previous.reviewedRevision === expectedUpdatedAt)
            return { status, alreadyReviewed: true };
        if (business.verificationStatus !== 'pending' || previous.status !== 'pending' || business.updatedAt !== expectedUpdatedAt)
            throw new https_1.HttpsError('failed-precondition', 'This account changed or was reviewed. Inspect the current record before deciding.');
        if (decision === 'approve' && (business.location?.coordinatesSource !== 'owner-confirmed' || !Number.isFinite(business.location?.lat) || Math.abs(business.location.lat) > 90 || !Number.isFinite(business.location?.lng) || Math.abs(business.location.lng) > 180))
            throw new https_1.HttpsError('failed-precondition', 'Confirm the actual business coordinates before approval.');
        const now = new Date().toISOString();
        transaction.update(ref, { verificationStatus: status, verificationBadge: decision === 'approve', verificationNote: note.trim(), updatedAt: now });
        transaction.update(requestRef, { status, reviewedBy: reviewer, reviewedRevision: expectedUpdatedAt, reviewedAt: now, note: note.trim() });
        return { status, alreadyReviewed: false };
    });
}
exports.reviewBusinessAccount = (0, https_1.onCall)(options, request => {
    if (!(0, authorization_1.hasAdminRole)(request.auth))
        throw new https_1.HttpsError('permission-denied', 'Administrator role required.');
    return reviewBusinessAccountRecord(request.data?.businessId, request.data?.decision, request.data?.expectedUpdatedAt, request.auth.uid, request.data?.note);
});
