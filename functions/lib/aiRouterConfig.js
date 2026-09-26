"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAiRoutes = readAiRoutes;
/** Ordered by operator preference: cheapest acceptable model first. No client-selected models/URLs. */
function readAiRoutes(env = process.env) {
    const defaults = [{
            id: 'gemini', provider: 'gemini',
            model: env.AI_GEMINI_MODEL || env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
            rpm: 60, tpm: 250000, dailyRequests: 1000, concurrency: 20, shards: 4, timeoutMs: 12000,
        }];
    const raw = env.AI_ROUTER_ROUTES ? JSON.parse(env.AI_ROUTER_ROUTES) : defaults;
    if (!Array.isArray(raw) || !raw.length || raw.length > 2)
        throw new Error('Configure one or two AI routes.');
    const providers = new Set();
    return raw.map((route) => {
        if (!route || !['gemini', 'groq'].includes(route.provider) || providers.has(route.provider)
            || route.id !== route.provider || typeof route.model !== 'string'
            || !/^[a-zA-Z0-9][a-zA-Z0-9./_-]{0,119}$/.test(route.model)) {
            throw new Error('AI routes require unique provider ids (gemini/groq) and a model name.');
        }
        providers.add(route.provider);
        for (const key of ['rpm', 'tpm', 'dailyRequests', 'concurrency', 'shards', 'timeoutMs']) {
            if (!Number.isSafeInteger(route[key]) || route[key] <= 0)
                throw new Error(`Invalid AI route ${key}.`);
        }
        if (route.shards > 64 || route.shards > Math.min(route.rpm, route.dailyRequests, route.concurrency)
            || route.concurrency > 10000 || route.timeoutMs < 1000 || route.timeoutMs > 25000) {
            throw new Error('Invalid AI route capacity/deadline.');
        }
        return { id: route.id, provider: route.provider, model: route.model, rpm: route.rpm, tpm: route.tpm,
            dailyRequests: route.dailyRequests, concurrency: route.concurrency, shards: route.shards, timeoutMs: route.timeoutMs };
    });
}
