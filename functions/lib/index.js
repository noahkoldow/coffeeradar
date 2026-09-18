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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewBusinessAccount = exports.createBusinessAccount = exports.moderateCommunityIdea = exports.requestAccountDeletion = exports.reviewBusinessListing = exports.validateBusinessCampaignCommitment = exports.recordBusinessCampaignEvent = exports.redeemCampaignVoucher = exports.issueCampaignVoucher = exports.getBusinessCampaignById = exports.reviewBusinessCampaign = exports.submitBusinessCampaign = exports.saveBusinessCampaign = exports.appStoreNotifications = exports.refreshPremiumEntitlement = exports.verifyPremiumPurchase = exports.getPremiumBillingConfiguration = exports.isAdmin = exports.fetchExternalData = exports.polishCommunityIdea = exports.rankTodoSlots = exports.markActivityVerified = exports.findOrGenerateActivity = exports.dbLookup = exports.setEmailVerificationPolicy = exports.getAccountAccess = void 0;
const aiImage_1 = require("./aiImage");
var accountAccess_1 = require("./accountAccess");
Object.defineProperty(exports, "getAccountAccess", { enumerable: true, get: function () { return accountAccess_1.getAccountAccess; } });
Object.defineProperty(exports, "setEmailVerificationPolicy", { enumerable: true, get: function () { return accountAccess_1.setEmailVerificationPolicy; } });
const aiQuota_1 = require("./aiQuota");
const authorization_1 = require("./authorization");
const functionsV1 = __importStar(require("firebase-functions/v1")); // Keep legacy callable signatures explicit.
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const node_fetch_1 = __importDefault(require("node-fetch"));
admin.initializeApp();
const db = admin.firestore();
const ACTIVITIES = 'activities';
function readConfigValue(path, fallback = '') {
    try {
        const value = path.split('.').reduce((acc, part) => {
            if (acc == null || acc === undefined)
                return undefined;
            return acc[part];
        }, functionsV1.config());
        return typeof value === 'string' ? value.trim() : String(value ?? fallback).trim();
    }
    catch {
        return String(fallback).trim();
    }
}
const ENFORCE_APP_CHECK = String(readConfigValue('app.enforce_app_check', process.env.ENFORCE_APP_CHECK ?? '')
    || process.env.ENFORCE_APP_CHECK
    || 'false').toLowerCase() === 'true';
const GEMINI_MODEL = String(readConfigValue('app.gemini_model', process.env.EXPO_PUBLIC_GEMINI_MODEL ?? '')
    || process.env.EXPO_PUBLIC_GEMINI_MODEL
    || process.env.GEMINI_MODEL).trim();
// Secret definitions for V2 functions
const GEMINI_API_KEY = (0, params_1.defineSecret)('GEMINI_API_KEY');
const TICKETMASTER_API_KEY = (0, params_1.defineSecret)('TICKETMASTER_API_KEY');
const SEATGEEK_CLIENT_ID = (0, params_1.defineSecret)('SEATGEEK_CLIENT_ID');
const SEATGEEK_CLIENT_SECRET = (0, params_1.defineSecret)('SEATGEEK_CLIENT_SECRET');
const GOOGLE_PLACES_API_KEY = (0, params_1.defineSecret)('GOOGLE_PLACES_API_KEY');
function requireAuth(ctx) {
    if (!ctx.auth) {
        console.warn('[CallableAuth] Rejecting unauthenticated callable request', {
            hasAuth: false,
            hasAppCheck: Boolean(ctx.app),
        });
        throw new functionsV1.https.HttpsError('unauthenticated', 'Authentication required');
    }
}
function requireAppCheck(ctx) {
    if (!ENFORCE_APP_CHECK)
        return;
    if (ctx.app)
        return;
    if (ctx.auth) {
        console.warn('App Check token missing for authenticated request; allowing request because App Check enforcement is enabled but this app currently relies on auth-based access.');
        return;
    }
    console.warn('[CallableAppCheck] Rejecting request missing App Check token', {
        hasAuth: Boolean(ctx.auth),
        hasAppCheck: false,
        enforced: ENFORCE_APP_CHECK,
    });
    throw new functionsV1.https.HttpsError('failed-precondition', 'App Check token required');
}
function requireAppCheckV2(request) {
    if (!ENFORCE_APP_CHECK)
        return;
    if (request.app)
        return;
    if (request.auth) {
        console.warn('App Check token missing for authenticated request; allowing request because App Check enforcement is enabled but this app currently relies on auth-based access.');
        return;
    }
    console.warn('[CallableAppCheck] Rejecting request missing App Check token', {
        hasAuth: Boolean(request.auth),
        hasAppCheck: false,
        enforced: ENFORCE_APP_CHECK,
    });
    throw new https_1.HttpsError('failed-precondition', 'App Check token required');
}
function normalizeScope(value) {
    return String(value || 'global').trim().toLowerCase() || 'global';
}
function makeRequestKey(wantedAttrs, timeHints, latLonBucket) {
    const attrs = normalizeAttributes(wantedAttrs);
    const times = normalizeAttributes(timeHints);
    const geo = normalizeScope(latLonBucket);
    return [attrs.join('|') || 'any', times.join('|') || 'any', geo].join('::');
}
async function searchActivities(wantedAttrs, timeHints, latLonBucket, minScore = 3, onlyVerified = false) {
    const requestKey = makeRequestKey(wantedAttrs, timeHints, latLonBucket);
    const exactSnap = await db.collection(ACTIVITIES).where('request_key', '==', requestKey).limit(1).get();
    if (!exactSnap.empty) {
        const exactDoc = exactSnap.docs[0];
        const exact = exactDoc.data();
        if (!exact.ttl_expires_at || exact.ttl_expires_at.toDate() > new Date()) {
            if (onlyVerified && !exact.verified)
                return null;
            return { item: { id: exactDoc.id, ...exact, source: 'DB' }, score: 100 };
        }
    }
    const queryCandidates = [];
    if (wantedAttrs.length) {
        queryCandidates.push(db.collection(ACTIVITIES).where('attributes', 'array-contains-any', wantedAttrs.slice(0, 10)).limit(50).get());
    }
    if (timeHints.length) {
        queryCandidates.push(db.collection(ACTIVITIES).where('time_tags', 'array-contains-any', timeHints.slice(0, 10)).limit(50).get());
    }
    if (latLonBucket) {
        queryCandidates.push(db.collection(ACTIVITIES).where('geo_scope', 'in', ['global', normalizeScope(latLonBucket)]).limit(30).get());
    }
    queryCandidates.push(db.collection(ACTIVITIES).orderBy('usage_count', 'desc').limit(25).get());
    const candidateSnaps = await Promise.all(queryCandidates);
    const candidates = candidateSnaps.flatMap(snap => snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    let best = null;
    let bestScore = -1;
    const seen = new Set();
    for (const c of candidates) {
        if (seen.has(c.id))
            continue;
        seen.add(c.id);
        const s = scoreMatch(c, wantedAttrs, timeHints, latLonBucket || '');
        if (s > bestScore || (s === bestScore && (c.usage_count || 0) > (best?.usage_count || 0))) {
            bestScore = s;
            best = c;
        }
    }
    if (best && bestScore >= minScore) {
        if (!best.ttl_expires_at || best.ttl_expires_at.toDate() > new Date()) {
            if (onlyVerified && !best.verified)
                return null;
            return { item: best, score: bestScore };
        }
    }
    return null;
}
function sanitizeString(s) {
    if (!s)
        return '';
    let str = String(s).trim();
    str = str.replace(/\b[\w.-]+@[\w.-]+\.[A-Za-z]{2,6}\b/g, '[email]');
    str = str.replace(/\+?\d[\d\s().-]{6,}\d/g, '[phone]');
    return str;
}
function determineTTLSeconds(generated, attrs) {
    if (generated && generated.expires_at) {
        const t = Date.parse(String(generated.expires_at));
        if (!isNaN(t))
            return Math.max(60, Math.floor((t - Date.now()) / 1000));
    }
    const promotions = attrs.some(a => /promo|coupon|offer|discount/.test(a));
    if (promotions)
        return 24 * 3600;
    const timeCritical = attrs.some(a => /event|tonight|today|now|soon|deadline|concert|show|screening|dinner|lunch|breakfast|meetup/.test(a));
    if (timeCritical)
        return 6 * 3600;
    const timeSensitive = attrs.some(a => /tonight|dinner|breakfast|lunch|weekend/.test(a));
    if (timeSensitive)
        return 12 * 3600;
    return 7 * 24 * 3600;
}
async function resolveGeminiApiKey() {
    const fromConfig = readConfigValue('app.gemini_api_key', '') || process.env.GEMINI_API_KEY || '';
    if (fromConfig)
        return String(fromConfig);
    try {
        return GEMINI_API_KEY.value();
    }
    catch (error) {
        return undefined;
    }
}
async function callGemini(prompt, options) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 24000) {
        throw new https_1.HttpsError('invalid-argument', 'A prompt between 1 and 24000 characters is required.');
    }
    const allowedModels = [GEMINI_MODEL, 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'].filter(Boolean);
    const model = typeof options.model === 'string' && allowedModels.includes(options.model) ? options.model : GEMINI_MODEL;
    if (!model)
        throw new https_1.HttpsError('failed-precondition', 'Gemini model is not configured.');
    const apiKey = await resolveGeminiApiKey();
    if (!apiKey)
        throw new https_1.HttpsError('failed-precondition', 'Gemini API key is not configured.');
    const schema = options.responseSchema;
    if (schema != null && (typeof schema !== 'object' || Array.isArray(schema) || JSON.stringify(schema).length > 16000)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid response schema.');
    }
    let image;
    try {
        image = (0, aiImage_1.validateAiImage)(options.image);
    }
    catch (error) {
        throw new https_1.HttpsError('invalid-argument', error.message);
    }
    const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) ? Math.min(25000, Math.max(1000, options.timeoutMs)) : 20000;
    const releaseBudget = await (0, aiQuota_1.acquireAiBudget)(db, options.uid);
    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await (0, node_fetch_1.default)(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }, ...(image ? [{ inlineData: image }] : [])] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    ...(/^gemini-3\.[56]-flash/.test(model) ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {}),
                    temperature: typeof options.temperature === 'number' && Number.isFinite(options.temperature) ? Math.min(1, Math.max(0, options.temperature)) : 0.3,
                    maxOutputTokens: typeof options.maxOutputTokens === 'number' && Number.isFinite(options.maxOutputTokens) ? Math.min(8192, Math.max(512, Math.floor(options.maxOutputTokens))) : 4096,
                    ...(schema ? { responseJsonSchema: schema } : {}),
                },
            }),
        });
        if (!resp.ok) {
            const code = resp.status === 429 ? 'resource-exhausted' : [401, 403].includes(resp.status) ? 'permission-denied' : [400, 404].includes(resp.status) ? 'failed-precondition' : 'unavailable';
            const retrySeconds = Number(resp.headers.get('retry-after'));
            throw new https_1.HttpsError(code, `Gemini HTTP ${resp.status}`, { providerHttpStatus: resp.status,
                ...(Number.isFinite(retrySeconds) && retrySeconds > 0 ? { retryAfterMs: Math.min(3600000, retrySeconds * 1000) } : {}) });
        }
        const data = await resp.json();
        const text = (data.candidates?.[0]?.content?.parts || []).filter((part) => part.thought !== true).map((part) => part.text || '').join('').trim();
        const finishReason = data.candidates?.[0]?.finishReason || 'unknown';
        console.info('Gemini provider response', { model, elapsedMs: Date.now() - startedAt, outputCharacters: text.length, finishReason,
            promptTokens: data.usageMetadata?.promptTokenCount, outputTokens: data.usageMetadata?.candidatesTokenCount, thinkingTokens: data.usageMetadata?.thoughtsTokenCount, totalTokens: data.usageMetadata?.totalTokenCount });
        if (!text)
            throw new https_1.HttpsError('unavailable', 'Gemini returned an empty response.', { reason: 'empty-output', finishReason });
        return text;
    }
    catch (error) {
        if (controller.signal.aborted)
            throw new https_1.HttpsError('deadline-exceeded', 'Gemini request timeout.');
        throw error;
    }
    finally {
        clearTimeout(timer);
        await releaseBudget();
    }
}
function normalizeAttributes(raw) {
    if (!raw)
        return [];
    return (raw || []).map((s) => String(s || '').toLowerCase().trim()).filter(Boolean).slice(0, 50);
}
function scoreMatch(item, wantedAttrs, timeTags, geoScope) {
    let score = 0;
    const attrs = item.attributes || [];
    for (const a of wantedAttrs)
        if (attrs.indexOf(a) !== -1)
            score += 2;
    for (const t of (timeTags || []))
        if ((item.time_tags || []).indexOf(t) !== -1)
            score += 1;
    if (item.geo_scope === 'global')
        score += 1;
    else if (geoScope && item.geo_scope === normalizeScope(geoScope))
        score += 3;
    if (item.verified)
        score += 0.5;
    score += Math.min(1.5, Math.log2((item.usage_count || 0) + 1) / 2);
    return score;
}
/**
 * Callable function: perform DB-first lookup for activities.
 * input: { attributes: string[], latLonBucket?: string, timeHints?: string[], minScore?: number }
 * returns: { hit: boolean, activity?: {...}, score?: number }
 */
exports.dbLookup = functionsV1.https.onCall(async (payload, ctx) => {
    requireAuth(ctx);
    requireAppCheck(ctx);
    const { attributes = [], latLonBucket, timeHints = [], minScore = 3 } = payload || {};
    const wantedAttrs = normalizeAttributes(attributes);
    // simple attribute query: use array-contains-any on the first up to 10 attrs
    const chunk = wantedAttrs.slice(0, 10);
    let candidatesSnap;
    if (chunk.length) {
        candidatesSnap = await db.collection(ACTIVITIES)
            .where('attributes', 'array-contains-any', chunk)
            .limit(50)
            .get();
    }
    else {
        const inList = latLonBucket ? ['global', latLonBucket] : ['global'];
        candidatesSnap = await db.collection(ACTIVITIES)
            .where('geo_scope', 'in', inList)
            .limit(30)
            .get();
    }
    const candidates = candidatesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    let best = null;
    let bestScore = -1;
    for (const c of candidates) {
        const s = scoreMatch(c, wantedAttrs, timeHints, latLonBucket);
        if (s > bestScore) {
            bestScore = s;
            best = c;
        }
    }
    if (best && bestScore >= minScore) {
        // check TTL if present
        if (!best.ttl_expires_at || best.ttl_expires_at.toDate() > new Date()) {
            // increment usage_count for metrics
            try {
                await db.collection(ACTIVITIES).doc(best.id).update({ usage_count: firestore_1.FieldValue.increment(1), deck_fit_count: firestore_1.FieldValue.increment(1), last_used_at: firestore_1.Timestamp.now() });
            }
            catch (e) { /* best-effort */ }
            // mark source so client knows
            best.source = 'DB';
            return { hit: true, activity: best, score: bestScore };
        }
    }
    return { hit: false };
});
// DB lookup endpoint only (Option B: client performs AI fallback generation).
// V2 callable with explicit public invoker to avoid infra-level callable rejection.
exports.findOrGenerateActivity = (0, https_1.onCall)({
    region: 'us-central1',
    invoker: 'public',
    secrets: [GEMINI_API_KEY],
}, async (request) => {
    if (!request.auth) {
        console.warn('[CallableAuth] Rejecting unauthenticated callable request', {
            hasAuth: false,
            hasAppCheck: Boolean(request.app),
        });
        throw new https_1.HttpsError('unauthenticated', 'Authentication required');
    }
    requireAppCheckV2(request);
    console.info('[findOrGenerateActivity] Callable request received', {
        hasAuth: true,
        hasAppCheck: Boolean(request.app),
        uid: request.auth.uid,
    });
    const payload = request.data;
    const { attributes = [], latLonBucket, timeHints = [], minScore = 3, intentText = '', onlyVerified = false } = payload || {};
    const wantedAttrs = normalizeAttributes(attributes || []);
    // 1) try DB
    const found = await searchActivities(wantedAttrs, timeHints, latLonBucket, minScore, onlyVerified);
    if (found) {
        try {
            await db.collection(ACTIVITIES).doc(found.item.id).update({ usage_count: firestore_1.FieldValue.increment(1), deck_fit_count: firestore_1.FieldValue.increment(1), last_used_at: firestore_1.Timestamp.now() });
        }
        catch (e) { }
        found.item.source = 'DB';
        return { source: 'db', activity: found.item, score: found.score };
    }
    // Option B: no server-side generation fallback. Client handles Firebase AI Logic generation.
    return {
        source: 'miss',
        activity: null,
        score: 0,
        reason: 'No DB activity hit. Client-side Firebase AI Logic should generate fallback.',
    };
});
// The legacy JWT-signed affiliate voucher system had no verifiable campaign ownership
// or usage-limit contract, and no client code called it. It is removed outright rather
// than left as a dead/failing endpoint; see ./campaigns for the server-verified replacement.
exports.markActivityVerified = functionsV1.https.onCall(async (data, ctx) => {
    requireAuth(ctx);
    requireAppCheck(ctx);
    if (!(0, authorization_1.hasAdminRole)(ctx.auth)) {
        throw new functionsV1.https.HttpsError('permission-denied', 'Administrator role required');
    }
    const { activityId, verified } = data || {};
    if (!activityId)
        throw new functionsV1.https.HttpsError('invalid-argument', 'activityId required');
    await db.collection(ACTIVITIES).doc(activityId).update({ verified: !!verified, updated_at: firestore_1.Timestamp.now() });
    return { success: true };
});
exports.rankTodoSlots = functionsV1.https.onCall(async (_data, ctx) => {
    requireAuth(ctx);
    requireAppCheck(ctx);
    throw new functionsV1.https.HttpsError('failed-precondition', 'rankTodoSlots is deprecated. Use client-side Firebase AI Logic ranking (Option B).');
});
exports.polishCommunityIdea = functionsV1.https.onCall(async (data, ctx) => {
    requireAuth(ctx);
    requireAppCheck(ctx);
    const idea = data.idea;
    if (!idea) {
        throw new functionsV1.https.HttpsError('invalid-argument', 'idea is required');
    }
    const prompt = [
        'Return ONLY valid JSON.',
        'Schema: {"hook":string,"description":string,"cta":string|null,"tags":string[]|null,"emojis":string[]|null,"timeOfDay":"any"|"morning"|"afternoon"|"evening"|null}',
        'Task: Improve readability and appeal for this community activity copy and fill optional missing fields without changing factual content.',
        'Hard constraints:',
        '- Keep the same activity intent, type, duration, place/event facts, and safety level.',
        '- Do not add new offers, prices, venues, schedules, claims, or instructions.',
        '- Keep tone concise and neutral-positive.',
        '- Keep tags short, lowercase, and broad (e.g. wellness, fitness, explore).',
        '- Keep emojis optional and minimal (0-3).',
        `Current hook: ${idea.hook}`,
        `Current description: ${idea.description}`,
        `Current cta: ${idea.cta ?? ''}`,
        `Type: ${idea.type}`,
        `Duration minutes: ${idea.durationMin}`,
        `Tags: ${(idea.tags ?? []).join(', ')}`,
        `Emojis: ${(idea.emojis ?? []).join(' ')}`,
        `Time of day: ${idea.timeOfDay ?? ''}`,
    ].join('\n');
    try {
        const resp = await callGemini(prompt, { uid: ctx.auth.uid });
        const parsed = tryParseModelText(resp) || {};
        return { payload: parsed };
    }
    catch (e) {
        console.error('polishCommunityIdea failed', e);
        throw new functionsV1.https.HttpsError('internal', 'Unable to polish idea right now');
    }
});
function tryParseModelText(txt) {
    if (!txt)
        return null;
    const jsonMatch = txt.match(/```(json)?\s*(\{[\s\S]*\})\s*```/m);
    if (jsonMatch && jsonMatch[2]) {
        try {
            return JSON.parse(jsonMatch[2]);
        }
        catch (e) {
            // Ignore parsing error and proceed to next check
        }
    }
    // Fallback for cases where the model might not use markdown code fences
    const looseJsonMatch = txt.match(/\{[\s\S]*\}/m);
    if (looseJsonMatch) {
        try {
            return JSON.parse(looseJsonMatch[0]);
        }
        catch (e) {
            // Ignore parsing error
        }
    }
    const lines = txt.split('\\n').map(s => s.trim()).filter(Boolean);
    if (lines.length)
        return { title: lines[0], description: lines.slice(1).join('\\n') };
    return null;
}
/**
 * HTTPS Callable V2 Cloud Function to act as a secure backend proxy.
 * Fetches data from multiple external third-party APIs concurrently.
 *
 * @param {Object} data - The data sent from the client.
 * @param {string} data.location - The location (city, coordinates) for event/place searches.
 * @param {string} data.geminiPrompt - The prompt for the Gemini API.
 * @param {string} [data.searchQuery] - An optional search query for events/places.
 */
exports.fetchExternalData = (0, https_1.onCall)({
    enforceAppCheck: ENFORCE_APP_CHECK,
    secrets: [GEMINI_API_KEY, TICKETMASTER_API_KEY, SEATGEEK_CLIENT_ID, SEATGEEK_CLIENT_SECRET, GOOGLE_PLACES_API_KEY]
}, async (request) => {
    // Ensure the user is authenticated
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication required.');
    }
    const { location, geminiPrompt, searchQuery } = request.data;
    if (geminiPrompt) {
        const consent = await db.doc(`users/${request.auth.uid}/consents/coreAI`).get();
        if (consent.data()?.allowed !== true) {
            throw new https_1.HttpsError('permission-denied', 'Accept the current AI processing notice before using AI features.');
        }
    }
    // The AI transport requests only Gemini. Do not wait for unrelated venue APIs or
    // access their credentials when no search was requested.
    if (location === 'unknown' && !searchQuery && geminiPrompt) {
        try {
            const text = await callGemini(geminiPrompt, {
                uid: request.auth.uid, model: request.data.geminiModel, responseSchema: request.data.geminiResponseSchema,
                maxOutputTokens: request.data.geminiMaxOutputTokens,
                temperature: request.data.geminiTemperature, timeoutMs: request.data.geminiTimeoutMs, image: request.data.geminiImage,
            });
            return { results: { Gemini: { status: 'success', data: text } } };
        }
        catch (error) {
            const code = error instanceof https_1.HttpsError ? error.code : 'unavailable';
            console.warn('Gemini callable failed', { code, ...(error instanceof https_1.HttpsError ? { providerHttpStatus: error.details?.providerHttpStatus, reason: error.details?.reason, finishReason: error.details?.finishReason } : {}) });
            return { results: { Gemini: { status: 'failed', error: code, retryAfterMs: error instanceof https_1.HttpsError ? error.details?.retryAfterMs : undefined } } };
        }
    }
    if (!location) {
        throw new https_1.HttpsError('invalid-argument', 'Location is required.');
    }
    // Hardcoded affiliate ID for Ticketmaster as per user's request.
    // Consider defining this as a secret if it needs to be configurable or kept private.
    const TICKETMASTER_AFFILIATE_ID = 'bitsAFF1';
    // Helper function to fetch data and handle errors gracefully
    const fetchData = async (apiName, url, options) => {
        try {
            const response = await (0, node_fetch_1.default)(url, options);
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Error fetching from ${apiName}: ${response.status} - ${errorText}`);
                return { apiName, status: 'failed', error: `API error: ${response.status}`, details: errorText };
            }
            const data = await response.json();
            return { apiName, status: 'success', data };
        }
        catch (error) {
            console.error(`Network or parsing error for ${apiName}:`, error);
            return { apiName, status: 'failed', error: `Network or parsing error: ${error.message}` };
        }
    };
    // Prepare concurrent API calls using Promise.allSettled
    const results = await Promise.allSettled([
        // 1. Google Gemini API
        (async () => {
            if (!geminiPrompt) {
                return { apiName: 'Gemini', status: 'skipped', message: 'No Gemini prompt provided.' };
            }
            try {
                // The existing callGemini function is now adapted to use the secret.
                const geminiResult = await callGemini(geminiPrompt, { uid: request.auth.uid });
                return { apiName: 'Gemini', status: 'success', data: geminiResult };
            }
            catch (error) {
                console.error('Error calling Gemini API:', error);
                return { apiName: 'Gemini', status: 'failed', error: error.message };
            }
        })(),
        // 2. Ticketmaster API
        fetchData('Ticketmaster', `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TICKETMASTER_API_KEY.value()}&city=${encodeURIComponent(location)}&keyword=${encodeURIComponent(searchQuery || '')}&sort=relevance,desc&segmentName=Music&locale=*&includeFamily=false&affiliateId=${TICKETMASTER_AFFILIATE_ID}`),
        // 3. SeatGeek API
        fetchData('SeatGeek', `https://api.seatgeek.com/2/events?client_id=${SEATGEEK_CLIENT_ID.value()}&client_secret=${SEATGEEK_CLIENT_SECRET.value()}&q=${encodeURIComponent(searchQuery || '')}&venue.city=${encodeURIComponent(location)}`),
        // 4. Google Places API (Find Place from Text)
        fetchData('Google Places', `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(searchQuery || location)}&inputtype=textquery&fields=place_id,name,formatted_address,geometry&key=${GOOGLE_PLACES_API_KEY.value()}`),
    ]);
    // Process results from all settled promises
    const aggregatedResults = {};
    results.forEach(result => {
        if (result.status === 'fulfilled') {
            const { apiName, ...data } = result.value;
            aggregatedResults[apiName] = data;
        }
        else {
            // Log rejected promises for debugging, but don't stop the overall response
            console.error('Promise rejected:', result.reason);
        }
    });
    return {
        message: 'External data fetched successfully (with some potential failures).',
        results: aggregatedResults,
    };
});
exports.isAdmin = functionsV1.https.onCall(async (_data, ctx) => {
    requireAuth(ctx);
    requireAppCheck(ctx);
    return { isAdmin: (0, authorization_1.hasAdminRole)(ctx.auth) };
});
var premium_1 = require("./premium");
Object.defineProperty(exports, "getPremiumBillingConfiguration", { enumerable: true, get: function () { return premium_1.getPremiumBillingConfiguration; } });
Object.defineProperty(exports, "verifyPremiumPurchase", { enumerable: true, get: function () { return premium_1.verifyPremiumPurchase; } });
Object.defineProperty(exports, "refreshPremiumEntitlement", { enumerable: true, get: function () { return premium_1.refreshPremiumEntitlement; } });
Object.defineProperty(exports, "appStoreNotifications", { enumerable: true, get: function () { return premium_1.appStoreNotifications; } });
var campaigns_1 = require("./campaigns");
Object.defineProperty(exports, "saveBusinessCampaign", { enumerable: true, get: function () { return campaigns_1.saveBusinessCampaign; } });
Object.defineProperty(exports, "submitBusinessCampaign", { enumerable: true, get: function () { return campaigns_1.submitBusinessCampaign; } });
Object.defineProperty(exports, "reviewBusinessCampaign", { enumerable: true, get: function () { return campaigns_1.reviewBusinessCampaign; } });
Object.defineProperty(exports, "getBusinessCampaignById", { enumerable: true, get: function () { return campaigns_1.getBusinessCampaignById; } });
Object.defineProperty(exports, "issueCampaignVoucher", { enumerable: true, get: function () { return campaigns_1.issueCampaignVoucher; } });
Object.defineProperty(exports, "redeemCampaignVoucher", { enumerable: true, get: function () { return campaigns_1.redeemCampaignVoucher; } });
Object.defineProperty(exports, "recordBusinessCampaignEvent", { enumerable: true, get: function () { return campaigns_1.recordBusinessCampaignEvent; } });
Object.defineProperty(exports, "validateBusinessCampaignCommitment", { enumerable: true, get: function () { return campaigns_1.validateBusinessCampaignCommitment; } });
var businessReview_1 = require("./businessReview");
Object.defineProperty(exports, "reviewBusinessListing", { enumerable: true, get: function () { return businessReview_1.reviewBusinessListing; } });
var accountDeletion_1 = require("./accountDeletion");
Object.defineProperty(exports, "requestAccountDeletion", { enumerable: true, get: function () { return accountDeletion_1.requestAccountDeletion; } });
var communityReview_1 = require("./communityReview");
Object.defineProperty(exports, "moderateCommunityIdea", { enumerable: true, get: function () { return communityReview_1.moderateCommunityIdea; } });
var businessAccounts_1 = require("./businessAccounts");
Object.defineProperty(exports, "createBusinessAccount", { enumerable: true, get: function () { return businessAccounts_1.createBusinessAccount; } });
Object.defineProperty(exports, "reviewBusinessAccount", { enumerable: true, get: function () { return businessAccounts_1.reviewBusinessAccount; } });
