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
exports.markActivityVerified = exports.vendorRedeem = exports.redeemVoucher = exports.generateVoucher = exports.findOrGenerateActivity = exports.dbLookup = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
admin.initializeApp();
const db = admin.firestore();
const ACTIVITIES = 'activities';
const VOUCHERS = 'vouchers';
const CONVERSIONS = 'conversions';
const VOUCHER_SECRET = functions.config().app?.voucher_secret || process.env.VOUCHER_SECRET || 'dev_voucher_secret';
async function searchActivities(wantedAttrs, timeHints, latLonBucket, minScore = 3, onlyVerified = false) {
    const chunk = wantedAttrs.slice(0, 10);
    let candidatesSnap;
    if (chunk.length) {
        candidatesSnap = await db.collection(ACTIVITIES).where('attributes', 'array-contains-any', chunk).limit(50).get();
    }
    else {
        const inList = latLonBucket ? ['global', latLonBucket] : ['global'];
        candidatesSnap = await db.collection(ACTIVITIES).where('geo_scope', 'in', inList).limit(30).get();
    }
    const candidates = candidatesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    let best = null;
    let bestScore = -1;
    for (const c of candidates) {
        const s = scoreMatch(c, wantedAttrs, timeHints, latLonBucket || '');
        if (s > bestScore) {
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
function fingerprint(obj) {
    return crypto_1.default.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
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
    const timeSensitive = attrs.some(a => /tonight|dinner|breakfast|lunch|weekend/.test(a));
    if (timeSensitive)
        return 12 * 3600;
    return 7 * 24 * 3600;
}
async function callGemini(prompt) {
    const apiUrl = functions.config().models?.api_url || process.env.MODEL_API_URL;
    const apiKey = functions.config().models?.api_key || process.env.MODEL_API_KEY;
    if (!apiUrl || !apiKey)
        throw new Error('models.api_url and models.api_key must be configured');
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    const resp = await (0, node_fetch_1.default)(apiUrl, { method: 'POST', headers, body: JSON.stringify({ prompt }) });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Model API error ${resp.status}: ${txt}`);
    }
    const text = await resp.text();
    try {
        return JSON.parse(text);
    }
    catch {
        return { text };
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
    else if (geoScope && item.geo_scope === geoScope)
        score += 3;
    return score;
}
/**
 * Callable function: perform DB-first lookup for activities.
 * input: { attributes: string[], latLonBucket?: string, timeHints?: string[], minScore?: number }
 * returns: { hit: boolean, activity?: {...}, score?: number }
 */
exports.dbLookup = functions.https.onCall(async (payload, ctx) => {
    if (!ctx.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
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
                await db.collection(ACTIVITIES).doc(best.id).update({ usage_count: admin.firestore.FieldValue.increment(1), last_used_at: admin.firestore.Timestamp.now() });
            }
            catch (e) { /* best-effort */ }
            // mark source so client knows
            best.source = 'DB';
            return { hit: true, activity: best, score: bestScore };
        }
    }
    return { hit: false };
});
// Full endpoint: DB-first lookup, then Gemini fallback, persist generated activity
exports.findOrGenerateActivity = functions.https.onCall(async (payload, ctx) => {
    if (!ctx.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    const { attributes = [], latLonBucket, timeHints = [], minScore = 3, intentText = '', onlyVerified = false } = payload || {};
    const wantedAttrs = normalizeAttributes(attributes || []);
    // 1) try DB
    const found = await searchActivities(wantedAttrs, timeHints, latLonBucket, minScore, onlyVerified);
    if (found) {
        try {
            await db.collection(ACTIVITIES).doc(found.item.id).update({ usage_count: admin.firestore.FieldValue.increment(1), last_used_at: admin.firestore.Timestamp.now() });
        }
        catch (e) { }
        found.item.source = 'DB';
        return { source: 'db', activity: found.item, score: found.score };
    }
    // 2) call Gemini
    const prompt = `Produce a JSON object with keys \"title\" and \"description\" for an activity.\nAttributes: ${wantedAttrs.join(', ')}. Time: ${timeHints.join(', ')}. Intent: ${intentText}`;
    let generated;
    try {
        const resp = await callGemini(prompt);
        if (resp.title && resp.description)
            generated = { title: resp.title, description: resp.description, expires_at: resp.expires_at };
        else if (resp.text) {
            const parsed = tryParseModelText(resp.text);
            generated = parsed || { title: wantedAttrs.slice(0, 3).join(', '), description: resp.text };
        }
        else
            generated = { title: wantedAttrs.slice(0, 3).join(', '), description: JSON.stringify(resp).slice(0, 1000) };
    }
    catch (e) {
        console.error('Gemini call failed', e);
        throw new functions.https.HttpsError('internal', 'Model call failed');
    }
    const now = admin.firestore.Timestamp.now();
    const ttlSeconds = determineTTLSeconds(generated, wantedAttrs);
    const expiresAt = ttlSeconds ? admin.firestore.Timestamp.fromMillis(Date.now() + ttlSeconds * 1000) : null;
    const doc = {
        title: sanitizeString(generated.title),
        description: sanitizeString(generated.description),
        attributes: wantedAttrs,
        time_tags: timeHints,
        geo_scope: latLonBucket || 'global',
        created_at: now,
        updated_at: now,
        source_info: { origin: 'AI', model_version: process.env.MODEL_VERSION || 'v1' },
        response_fingerprint: fingerprint(generated),
        usage_count: 1,
        verified: false,
        ttl_expires_at: expiresAt
    };
    // dedupe
    const dupQs = await db.collection(ACTIVITIES).where('response_fingerprint', '==', doc.response_fingerprint).limit(1).get();
    if (!dupQs.empty) {
        const existing = dupQs.docs[0];
        await existing.ref.update({ usage_count: admin.firestore.FieldValue.increment(1), last_used_at: now });
        const exData = (await existing.ref.get()).data();
        exData.id = existing.id;
        exData.source = 'DB';
        return { source: 'db', activity: exData, deduped: true };
    }
    const ref = await db.collection(ACTIVITIES).add(doc);
    const savedSnap = await ref.get();
    const saved = savedSnap.data();
    saved.id = ref.id;
    saved.source = 'AI';
    return { source: 'model', activity: saved };
});
// Voucher generation
exports.generateVoucher = functions.https.onCall(async (data, ctx) => {
    if (!ctx.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    const { affiliateId, expiresInSecs = 3600, userId } = data || {};
    if (!affiliateId)
        throw new functions.https.HttpsError('invalid-argument', 'affiliateId required');
    const voucherId = crypto_1.default.randomUUID();
    const payload = { voucherId, affiliateId, userId: userId || ctx.auth.uid, iat: Math.floor(Date.now() / 1000) };
    const token = jsonwebtoken_1.default.sign(payload, VOUCHER_SECRET, { expiresIn: expiresInSecs });
    const now = admin.firestore.Timestamp.now();
    const doc = {
        affiliate_id: affiliateId,
        created_at: now,
        expires_at: admin.firestore.Timestamp.fromMillis(Date.now() + expiresInSecs * 1000),
        redeemed: false,
        token_sig: crypto_1.default.createHash('sha256').update(token).digest('hex'),
        userId: userId || ctx.auth.uid
    };
    await db.collection(VOUCHERS).doc(voucherId).set(doc);
    return { voucherToken: token, voucherId };
});
// Redeem voucher (callable)
exports.redeemVoucher = functions.https.onCall(async (data, ctx) => {
    const { voucherToken, proof } = data || {};
    if (!voucherToken)
        throw new functions.https.HttpsError('invalid-argument', 'voucherToken required');
    let decoded;
    try {
        decoded = jsonwebtoken_1.default.verify(voucherToken, VOUCHER_SECRET);
    }
    catch (e) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid token');
    }
    const voucherId = decoded.voucherId;
    const tokenHash = crypto_1.default.createHash('sha256').update(voucherToken).digest('hex');
    const voucherRef = db.collection(VOUCHERS).doc(voucherId);
    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(voucherRef);
            if (!snap.exists)
                throw new functions.https.HttpsError('not-found', 'Voucher not found');
            const v = snap.data();
            if (v.token_sig !== tokenHash)
                throw new functions.https.HttpsError('failed-precondition', 'Token mismatch');
            if (v.redeemed)
                throw new functions.https.HttpsError('failed-precondition', 'Already redeemed');
            if (v.expires_at && v.expires_at.toMillis() < Date.now())
                throw new functions.https.HttpsError('failed-precondition', 'Expired');
            tx.update(voucherRef, { redeemed: true, redeemed_at: admin.firestore.Timestamp.now(), proof });
            tx.set(db.collection(CONVERSIONS).doc(), { voucherId, affiliateId: decoded.affiliateId, userId: decoded.userId, created_at: admin.firestore.Timestamp.now(), proof });
        });
    }
    catch (e) {
        if (e instanceof functions.https.HttpsError)
            throw e;
        throw new functions.https.HttpsError('internal', String(e));
    }
    return { success: true };
});
// Vendor webhook
exports.vendorRedeem = functions.https.onRequest(async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).send('Method not allowed');
            return;
        }
        const vendorKeyHeader = (req.headers['x-vendor-key'] || req.headers['X-Vendor-Key'] || '');
        const vendorKeysRaw = functions.config().vendors?.api_keys || process.env.VENDOR_KEYS || '';
        const vendorKeys = String(vendorKeysRaw).split(',').map(s => s.trim()).filter(Boolean);
        if (!vendorKeys.includes(vendorKeyHeader)) {
            res.status(401).send('Unauthorized');
            return;
        }
        const { voucherToken, vendorId, orderId, amount, vendorProof } = req.body || {};
        if (!voucherToken) {
            res.status(400).send('voucherToken required');
            return;
        }
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(voucherToken, VOUCHER_SECRET);
        }
        catch (e) {
            res.status(400).send('Invalid token');
            return;
        }
        const voucherId = decoded.voucherId;
        const tokenHash = crypto_1.default.createHash('sha256').update(voucherToken).digest('hex');
        const voucherRef = db.collection(VOUCHERS).doc(voucherId);
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(voucherRef);
            if (!snap.exists)
                throw new Error('Voucher not found');
            const v = snap.data();
            if (v.token_sig !== tokenHash)
                throw new Error('Token mismatch');
            if (v.redeemed)
                throw new Error('Already redeemed');
            if (v.expires_at && v.expires_at.toMillis() < Date.now())
                throw new Error('Expired');
            if (v.vendor_id && vendorId && v.vendor_id !== vendorId)
                throw new Error('Vendor mismatch');
            tx.update(voucherRef, { redeemed: true, redeemed_at: admin.firestore.Timestamp.now(), proof: { vendorId, orderId, amount, vendorProof } });
            tx.set(db.collection(CONVERSIONS).doc(), { voucherId, affiliateId: decoded.affiliateId, vendorId: vendorId || null, orderId: orderId || null, amount: amount || null, userId: decoded.userId, created_at: admin.firestore.Timestamp.now(), proof: vendorProof || null });
        });
        res.status(200).json({ success: true });
        return;
    }
    catch (e) {
        console.error('vendorRedeem error', e);
        res.status(500).send('internal error');
        return;
    }
});
exports.markActivityVerified = functions.https.onCall(async (data, ctx) => {
    if (!ctx.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    const adminEmailsRaw = functions.config().app?.admin_emails || process.env.ADMIN_EMAILS || '';
    const adminEmails = String(adminEmailsRaw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const userEmail = (ctx.auth.token.email || '').toLowerCase();
    if (!adminEmails.includes(userEmail))
        throw new functions.https.HttpsError('permission-denied', 'Not an admin');
    const { activityId, verified } = data || {};
    if (!activityId)
        throw new functions.https.HttpsError('invalid-argument', 'activityId required');
    await db.collection(ACTIVITIES).doc(activityId).update({ verified: !!verified, updated_at: admin.firestore.Timestamp.now() });
    return { success: true };
});
function tryParseModelText(txt) {
    if (!txt)
        return null;
    const jsonMatch = txt.match(/\{[\s\S]*\}/m);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.title && parsed.description)
                return { title: parsed.title, description: parsed.description, expires_at: parsed.expires_at };
        }
        catch (e) { }
    }
    const lines = txt.split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length)
        return { title: lines[0], description: lines.slice(1).join('\n') };
    return null;
}
