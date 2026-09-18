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
exports.moderateCommunityIdea = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const authorization_1 = require("./authorization");
const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
function validContent(data) {
    const list = (value, maximum) => value === undefined || (Array.isArray(value) && value.length <= maximum && value.every(tag => text(tag, 80)));
    if (!data || !text(data.title, 160) || !text(data.hook, 300) || !text(data.description, 3000)
        || !['AT_HOME', 'GO_OUT', 'EVENT'].includes(data.type) || !Number.isFinite(data.durationMin) || data.durationMin < 1 || data.durationMin > 1440
        || !list(data.tags, 10) || !list(data.emojis, 6))
        return false;
    for (const field of ['cta', 'imageUrl', 'submittedByEmail'])
        if (data[field] != null && typeof data[field] !== 'string')
            return false;
    if (data.place != null && (typeof data.place !== 'object' || !text(data.place.name, 200)
        || (data.place.address != null && typeof data.place.address !== 'string')
        || (data.place.lat != null && (!Number.isFinite(data.place.lat) || Math.abs(data.place.lat) > 90))
        || (data.place.lng != null && (!Number.isFinite(data.place.lng) || Math.abs(data.place.lng) > 180))))
        return false;
    if (data.timeOfDay != null && !['any', 'morning', 'afternoon', 'evening'].includes(data.timeOfDay))
        return false;
    if (data.event != null && (typeof data.event !== 'object' || Array.isArray(data.event) || !text(data.event.startAt, 80) || !text(data.event.venue, 200) || !text(data.event.ticketUrl, 2048) || Object.values(data.event).some(value => value != null && typeof value !== 'string')))
        return false;
    return true;
}
function contentSnapshot(data) {
    const canonical = (value) => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    return JSON.stringify(['title', 'hook', 'description', 'type', 'durationMin', 'cta', 'tags', 'emojis', 'place', 'event', 'imageUrl', 'timeOfDay'].map(key => canonical(data[key] ?? null)));
}
/** Reviewer identity is authenticated; publication and queue decision are indivisible. */
exports.moderateCommunityIdea = (0, https_1.onCall)({ timeoutSeconds: 30 }, async (request) => {
    if (!(0, authorization_1.hasAdminRole)(request.auth))
        throw new https_1.HttpsError('permission-denied', 'Administrator role required.');
    const { ideaId, action, note, expectedContent } = request.data || {};
    if (typeof ideaId !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(ideaId) || !['approve', 'reject'].includes(action))
        throw new https_1.HttpsError('invalid-argument', 'Valid idea and decision required.');
    if ((note != null && !text(note, 1000)) || (action === 'reject' && !text(note, 1000)))
        throw new https_1.HttpsError('invalid-argument', 'A rejection reason of up to 1000 characters is required.');
    const db = admin.firestore();
    const ideaRef = db.doc(`community_ideas/${ideaId}`);
    const queueRef = db.doc(`approval_queue/${ideaId}`);
    return db.runTransaction(async (transaction) => {
        const [idea, queue] = await Promise.all([transaction.get(ideaRef), transaction.get(queueRef)]);
        if (!idea.exists)
            throw new https_1.HttpsError('not-found', 'Submission not found.');
        const data = idea.data();
        if (queue.exists && (queue.data()?.kind !== 'community_idea' || queue.data()?.ideaId !== ideaId))
            throw new https_1.HttpsError('failed-precondition', 'Review queue identifier conflict. No records changed.');
        const status = action === 'approve' ? 'approved' : 'rejected';
        if (data.status === status && queue.data()?.status === status)
            return { status, alreadyReviewed: true };
        if (data.status !== 'pending')
            throw new https_1.HttpsError('failed-precondition', 'This idea was already reviewed. Refresh the queue.');
        if (typeof expectedContent !== 'string' || expectedContent !== contentSnapshot(data))
            throw new https_1.HttpsError('aborted', 'This submission changed after you opened it. Reload the queue and review its current content.');
        if (action === 'approve' && !validContent(data))
            throw new https_1.HttpsError('failed-precondition', 'Incomplete legacy idea. Ask its owner to correct the content before publication.');
        const review = { status, reviewedAt: new Date().toISOString(), reviewerId: request.auth.uid, reviewNote: note?.trim() || null };
        transaction.update(ideaRef, review);
        transaction.set(queueRef, { kind: 'community_idea', ideaId, ...review }, { merge: true });
        return { status, alreadyReviewed: false };
    });
});
