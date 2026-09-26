"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FirestoreProviderBudget = void 0;
exports.reserveProviderBudget = reserveProviderBudget;
const crypto_1 = require("crypto");
const share = (total, shards, shard) => Math.floor(total / shards) + (shard < total % shards ? 1 : 0);
/** Shards have disjoint budgets: their sums never exceed the configured total. Failed attempts still count. */
function reserveProviderBudget(state, route, shard, tokens, now, requestId) {
    const minute = Math.floor(now / 60000);
    const day = new Date(now).toISOString().slice(0, 10);
    const requests = state.minute === minute ? state.requests || 0 : 0;
    const usedTokens = state.minute === minute ? state.tokens || 0 : 0;
    const dailyRequests = state.day === day ? state.dailyRequests || 0 : 0;
    const active = Object.fromEntries(Object.entries(state.active || {}).filter(([, expires]) => expires > now));
    if (dailyRequests >= share(route.dailyRequests, route.shards, shard)) {
        return { allowed: false, retryAfterMs: Date.parse(`${day}T00:00:00Z`) + 86400000 - now };
    }
    if (requests >= share(route.rpm, route.shards, shard) || usedTokens + tokens > share(route.tpm, route.shards, shard)) {
        return { allowed: false, retryAfterMs: (minute + 1) * 60000 - now };
    }
    if (Object.keys(active).length >= share(route.concurrency, route.shards, shard)) {
        return { allowed: false, retryAfterMs: Math.max(1000, Math.min(...Object.values(active)) - now) };
    }
    return { allowed: true, state: { minute, requests: requests + 1, tokens: usedTokens + tokens, day,
            dailyRequests: dailyRequests + 1, active: { ...active, [requestId]: now + 45000 } } };
}
class FirestoreProviderBudget {
    constructor(db) {
        this.db = db;
        this.localCooldowns = new Map();
    }
    async acquire(route, tokens) {
        const localRemaining = (this.localCooldowns.get(route.id) || 0) - Date.now();
        if (localRemaining > 0)
            return { retryAfterMs: localRemaining };
        const start = (0, crypto_1.randomInt)(route.shards);
        const requestId = (0, crypto_1.randomUUID)();
        let retryAfterMs = Infinity;
        // Two choices avoid a single hot document. Do not scan every shard under overload.
        for (let attempt = 0; attempt < Math.min(2, route.shards); attempt++) {
            const shard = (start + attempt) % route.shards;
            const ref = this.db.doc(`ai_provider_budgets/${route.id}_${shard}`);
            const healthRef = this.db.doc(`ai_provider_health/${route.id}`);
            const decision = await this.db.runTransaction(async (transaction) => {
                const [snapshot, health] = await Promise.all([transaction.get(ref), transaction.get(healthRef)]);
                const now = Date.now();
                const until = Number(health.data()?.until) || 0;
                if (until > now) {
                    this.localCooldowns.set(route.id, until);
                    return { allowed: false, retryAfterMs: until - now };
                }
                const result = reserveProviderBudget(snapshot.data() || {}, route, shard, tokens, now, requestId);
                if (result.allowed)
                    transaction.set(ref, result.state);
                return result;
            }, { maxAttempts: 3 });
            if (decision.allowed)
                return { release: async () => {
                        await this.db.runTransaction(async (transaction) => {
                            const snapshot = await transaction.get(ref);
                            const state = snapshot.data() || {};
                            const active = { ...(state.active || {}) };
                            delete active[requestId];
                            transaction.set(ref, { ...state, active });
                        }, { maxAttempts: 3 }).catch(() => undefined); // Crash-safe lease expiry also releases capacity.
                    } };
            retryAfterMs = Math.min(retryAfterMs, decision.retryAfterMs);
            if ((this.localCooldowns.get(route.id) || 0) > Date.now())
                break;
        }
        return { retryAfterMs };
    }
    async cooldown(route, retryAfterMs) {
        const until = Date.now() + Math.min(3600000, Math.max(1000, retryAfterMs));
        if ((this.localCooldowns.get(route.id) || 0) >= until - 1000)
            return;
        this.localCooldowns.set(route.id, until);
        await this.db.runTransaction(async (transaction) => {
            const ref = this.db.doc(`ai_provider_health/${route.id}`);
            const snapshot = await transaction.get(ref);
            if ((Number(snapshot.data()?.until) || 0) < until)
                transaction.set(ref, { until });
        }, { maxAttempts: 3 }).catch(() => undefined);
    }
}
exports.FirestoreProviderBudget = FirestoreProviderBudget;
