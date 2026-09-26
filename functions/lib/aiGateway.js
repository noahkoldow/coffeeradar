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
exports.generateAiJson = exports.AiRequestCache = exports.AI_FUNCTION_OPTIONS = exports.AI_PROVIDER_KEYS = void 0;
exports.generateForUser = generateForUser;
const crypto_1 = require("crypto");
const admin = __importStar(require("firebase-admin"));
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const aiQuota_1 = require("./aiQuota");
const aiRouter_1 = require("./aiRouter");
const aiProviderBudget_1 = require("./aiProviderBudget");
const aiRouterConfig_1 = require("./aiRouterConfig");
const aiConsent_1 = require("./aiConsent");
const aiDeadline_1 = require("./aiDeadline");
// One JSON secret permits optional providers without requiring unused secrets at deployment.
exports.AI_PROVIDER_KEYS = (0, params_1.defineSecret)('AI_PROVIDER_KEYS');
exports.AI_FUNCTION_OPTIONS = { region: 'us-central1', cpu: 1, memory: '512MiB',
    concurrency: 40, maxInstances: 50, minInstances: 0, timeoutSeconds: 60,
    enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true', secrets: [exports.AI_PROVIDER_KEYS] };
/** Per-instance, short-lived, identity-scoped response reuse. Never writes prompts/photos to Firestore. */
class AiRequestCache {
    constructor() {
        this.pending = new Map();
        this.cached = new Map();
        this.bytes = 0;
    }
    async run(key, cacheable, work) {
        for (const [id, entry] of this.cached) {
            if (entry.expires <= Date.now()) {
                this.cached.delete(id);
                this.bytes -= entry.bytes;
            }
        }
        const hit = this.cached.get(key);
        if (cacheable && hit)
            return hit.result;
        const running = this.pending.get(key);
        if (running)
            return running;
        if (this.pending.size >= 80)
            throw new https_1.HttpsError('resource-exhausted', 'AI server is busy.', { retryAfterMs: 2000 });
        const promise = work().then(result => {
            const bytes = Buffer.byteLength(result.text);
            if (cacheable && bytes <= 128000) {
                while (this.cached.size >= 64 || this.bytes + bytes > 2 * 1024 * 1024) {
                    const first = this.cached.entries().next().value;
                    if (!first)
                        break;
                    this.cached.delete(first[0]);
                    this.bytes -= first[1].bytes;
                }
                this.cached.set(key, { result, bytes, expires: Date.now() + 30000 });
                this.bytes += bytes;
            }
            return result;
        }).finally(() => { this.pending.delete(key); });
        this.pending.set(key, promise);
        return promise;
    }
}
exports.AiRequestCache = AiRequestCache;
const cache = new AiRequestCache();
let router;
function getRouter() {
    if (router)
        return router;
    let keys;
    try {
        keys = JSON.parse(exports.AI_PROVIDER_KEYS.value());
        if (!keys || Array.isArray(keys) || typeof keys !== 'object'
            || Object.values(keys).some(value => typeof value !== 'string'))
            throw new Error();
        router = new aiRouter_1.AiRouter((0, aiRouterConfig_1.readAiRoutes)(), keys, new aiProviderBudget_1.FirestoreProviderBudget(admin.firestore()));
        return router;
    }
    catch {
        throw new https_1.HttpsError('failed-precondition', 'AI provider configuration is invalid.');
    }
}
/** Also used by legacy callables so they cannot bypass consent, model policy or quotas. */
async function generateForUser(uid, input) {
    if (!uid)
        throw new https_1.HttpsError('unauthenticated', 'Sign in first.');
    const request = (0, aiRouter_1.validateAiRequest)(input);
    const deadline = Date.now() + request.timeoutMs;
    const db = admin.firestore();
    const consent = (await (0, aiDeadline_1.beforeDeadline)(db.doc(`users/${uid}/consents/coreAI`).get(), Math.min(deadline, Date.now() + 3000))).data();
    if (consent?.allowed !== true || consent.version !== aiConsent_1.CORE_AI_CONSENT_VERSION) {
        throw new https_1.HttpsError('permission-denied', 'Accept the current AI processing notice in Settings before using AI.');
    }
    const allowedProviders = ['gemini', 'groq'].filter(provider => Array.isArray(consent.providers) && consent.providers.includes(provider));
    const currentRouter = getRouter();
    const key = (0, crypto_1.createHash)('sha256').update(JSON.stringify([uid, allowedProviders, request])).digest('hex');
    return (0, aiDeadline_1.beforeDeadline)(cache.run(key, !request.image, async () => {
        const release = await (0, aiDeadline_1.beforeDeadline)((0, aiQuota_1.acquireAiBudget)(db, uid), Math.min(deadline, Date.now() + 3000), lateRelease => lateRelease());
        try {
            const remaining = deadline - Date.now();
            if (remaining <= 0)
                throw new https_1.HttpsError('deadline-exceeded', 'AI request timed out.');
            return await currentRouter.generate({ ...request, timeoutMs: remaining }, allowedProviders);
        }
        finally {
            await (0, aiDeadline_1.releaseBeforeDeadline)(release, deadline);
        }
    }), deadline);
}
exports.generateAiJson = (0, https_1.onCall)(exports.AI_FUNCTION_OPTIONS, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in first.');
    const result = await generateForUser(request.auth.uid, request.data);
    return { text: result.text };
});
