import { createHash } from 'crypto';
import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { acquireAiBudget } from './aiQuota';
import { AiRouter, validateAiRequest, type AiInput, type AiResult } from './aiRouter';
import { FirestoreProviderBudget } from './aiProviderBudget';
import { readAiRoutes, type AiProvider } from './aiRouterConfig';
import { CORE_AI_CONSENT_VERSION } from './aiConsent';
import { beforeDeadline, releaseBeforeDeadline } from './aiDeadline';

// One JSON secret permits optional providers without requiring unused secrets at deployment.
export const AI_PROVIDER_KEYS = defineSecret('AI_PROVIDER_KEYS');
export const AI_FUNCTION_OPTIONS = { region: 'us-central1', cpu: 1, memory: '512MiB' as const,
  concurrency: 40, maxInstances: 50, minInstances: 0, timeoutSeconds: 60,
  enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true', secrets: [AI_PROVIDER_KEYS] };

/** Per-instance, short-lived, identity-scoped response reuse. Never writes prompts/photos to Firestore. */
export class AiRequestCache {
  private readonly pending = new Map<string, Promise<AiResult>>();
  private readonly cached = new Map<string, { result: AiResult; expires: number; bytes: number }>();
  private bytes = 0;

  async run(key: string, cacheable: boolean, work: () => Promise<AiResult>): Promise<AiResult> {
    for (const [id, entry] of this.cached) {
      if (entry.expires <= Date.now()) { this.cached.delete(id); this.bytes -= entry.bytes; }
    }
    const hit = this.cached.get(key);
    if (cacheable && hit) return hit.result;
    const running = this.pending.get(key);
    if (running) return running;
    if (this.pending.size >= 80) throw new HttpsError('resource-exhausted', 'AI server is busy.', { retryAfterMs: 2000 });
    const promise = work().then(result => {
      const bytes = Buffer.byteLength(result.text);
      if (cacheable && bytes <= 128000) {
        while (this.cached.size >= 64 || this.bytes + bytes > 2 * 1024 * 1024) {
          const first = this.cached.entries().next().value;
          if (!first) break;
          this.cached.delete(first[0]); this.bytes -= first[1].bytes;
        }
        this.cached.set(key, { result, bytes, expires: Date.now() + 30000 }); this.bytes += bytes;
      }
      return result;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, promise);
    return promise;
  }
}

const cache = new AiRequestCache();
let router: AiRouter | undefined;
function getRouter(): AiRouter {
  if (router) return router;
  let keys: Partial<Record<AiProvider, string>>;
  try {
    keys = JSON.parse(AI_PROVIDER_KEYS.value());
    if (!keys || Array.isArray(keys) || typeof keys !== 'object'
      || Object.values(keys).some(value => typeof value !== 'string')) throw new Error();
    router = new AiRouter(readAiRoutes(), keys, new FirestoreProviderBudget(admin.firestore()));
    return router;
  } catch {
    throw new HttpsError('failed-precondition', 'AI provider configuration is invalid.');
  }
}

/** Also used by legacy callables so they cannot bypass consent, model policy or quotas. */
export async function generateForUser(uid: string, input: AiInput): Promise<AiResult> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const request = validateAiRequest(input);
  const deadline = Date.now() + request.timeoutMs;
  const db = admin.firestore();
  const consent = (await beforeDeadline(db.doc(`users/${uid}/consents/coreAI`).get(), Math.min(deadline, Date.now() + 3000))).data();
  if (consent?.allowed !== true || consent.version !== CORE_AI_CONSENT_VERSION) {
    throw new HttpsError('permission-denied', 'Accept the current AI processing notice in Settings before using AI.');
  }
  const allowedProviders = (['gemini', 'groq'] as const).filter(provider => Array.isArray(consent.providers) && consent.providers.includes(provider));
  const currentRouter = getRouter();
  const key = createHash('sha256').update(JSON.stringify([uid, allowedProviders, request])).digest('hex');
  return beforeDeadline(cache.run(key, !request.image, async () => {
    const release = await beforeDeadline(acquireAiBudget(db, uid), Math.min(deadline, Date.now() + 3000), lateRelease => lateRelease());
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new HttpsError('deadline-exceeded', 'AI request timed out.');
      return await currentRouter.generate({ ...request, timeoutMs: remaining }, allowedProviders);
    } finally { await releaseBeforeDeadline(release, deadline); }
  }), deadline);
}

export const generateAiJson = onCall(AI_FUNCTION_OPTIONS, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const result = await generateForUser(request.auth.uid, request.data);
  return { text: result.text };
});
