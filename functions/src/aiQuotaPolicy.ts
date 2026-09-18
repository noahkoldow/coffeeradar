export type AiQuotaState = { day?: string; dayCount?: number; minute?: number; minuteCount?: number; active?: Record<string, number> };
export type AiQuotaDecision = { allowed: true; state: AiQuotaState } | { allowed: false; reason: 'daily' | 'rate' | 'concurrency'; retryAfterMs: number };

export function reserveAiQuota(state: AiQuotaState, now: number, premium: boolean, requestId: string): AiQuotaDecision {
  const day = new Date(now).toISOString().slice(0, 10);
  const minute = Math.floor(now / 60000);
  const dayCount = state.day === day ? Math.max(0, state.dayCount || 0) : 0;
  const minuteCount = state.minute === minute ? Math.max(0, state.minuteCount || 0) : 0;
  const active = Object.fromEntries(Object.entries(state.active || {}).filter(([, expiry]) => Number.isFinite(expiry) && expiry > now));
  if (dayCount >= (premium ? 100 : 50)) return { allowed: false, reason: 'daily', retryAfterMs: Date.parse(`${day}T00:00:00Z`) + 86400000 - now };
  if (minuteCount >= 6) return { allowed: false, reason: 'rate', retryAfterMs: (minute + 1) * 60000 - now };
  if (Object.keys(active).length >= 2) return { allowed: false, reason: 'concurrency', retryAfterMs: Math.max(1000, Math.min(...Object.values(active)) - now) };
  return { allowed: true, state: { day, dayCount: dayCount + 1, minute, minuteCount: minuteCount + 1, active: { ...active, [requestId]: now + 45000 } } };
}

export function hasPremiumAiBudget(entitlement: Record<string, unknown> | undefined, now: number, environment = 'Production'): boolean {
  return entitlement?.active === true && entitlement.environment === environment && typeof entitlement.expiresAtMs === 'number' && entitlement.expiresAtMs > now;
}
