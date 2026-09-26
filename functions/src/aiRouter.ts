import { HttpsError } from 'firebase-functions/v2/https';
import { validateAiImage } from './aiImage';
import { normalizeAiSchema, matchesAiSchema } from './aiSchema';
import type { AiProvider, AiRoute } from './aiRouterConfig';
import type { ProviderBudget } from './aiProviderBudget';
import { beforeDeadline, releaseBeforeDeadline } from './aiDeadline';

export type AiInput = { prompt?: unknown; image?: unknown; responseSchema?: unknown; maxOutputTokens?: unknown;
  temperature?: unknown; timeoutMs?: unknown; model?: unknown };
export type AiRequest = { prompt: string; image?: ReturnType<typeof validateAiImage>;
  responseSchema?: ReturnType<typeof normalizeAiSchema>; maxOutputTokens: number; temperature: number; timeoutMs: number };
export type AiResult = { text: string; provider: AiProvider; model: string };
const bounded = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function validateAiRequest(input: AiInput): AiRequest {
  if (!input || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 24000) {
    throw new HttpsError('invalid-argument', 'A prompt between 1 and 24000 characters is required.');
  }
  let image: ReturnType<typeof validateAiImage>;
  try { image = validateAiImage(input.image); } catch (error) { throw new HttpsError('invalid-argument', (error as Error).message); }
  const responseSchema = normalizeAiSchema(input.responseSchema);
  if (responseSchema && responseSchema.type !== 'object') {
    throw new HttpsError('invalid-argument', 'The response schema must describe a JSON object at its root.');
  }
  return { prompt: input.prompt, image, responseSchema,
    maxOutputTokens: Math.floor(bounded(input.maxOutputTokens, 4096, 128, 8192)),
    temperature: bounded(input.temperature, 0.3, 0, 1), timeoutMs: Math.floor(bounded(input.timeoutMs, 20000, 1000, 25000)) };
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(duration) && duration > 0 ? Math.min(3600000, Math.max(1000, duration)) : undefined;
}

class ProviderFailure extends Error {
  constructor(readonly code: 'unavailable' | 'failed-precondition' | 'resource-exhausted' | 'deadline-exceeded' | 'permission-denied',
    readonly retryable: boolean, readonly cooldownMs = 0, readonly status?: number) { super(code); }
}

export class AiRouter {
  constructor(private readonly routes: AiRoute[], private readonly keys: Partial<Record<AiProvider, string>>,
    private readonly budget: ProviderBudget, private readonly transport: typeof fetch = fetch) {}

  async generate(request: AiRequest, allowedProviders: AiProvider[]): Promise<AiResult> {
    const routes = this.routes.filter(route => allowedProviders.includes(route.provider) && this.keys[route.provider]
      && (!request.image || route.provider === 'gemini'));
    if (!routes.length) throw new HttpsError('failed-precondition', 'No configured AI provider supports this request.');
    const deadline = Date.now() + request.timeoutMs;
    let lastError: ProviderFailure | undefined;
    let retryAfterMs = Infinity;
    // Byte-based text estimate deliberately over-reserves. Image tokenization is provider-specific.
    const tokens = Buffer.byteLength(request.prompt + JSON.stringify(request.responseSchema || {}), 'utf8')
      + request.maxOutputTokens + 512 + (request.image ? 16384 : 0);
    for (const route of routes) {
      if (Date.now() >= deadline) break;
      const lease = await beforeDeadline(this.budget.acquire(route, tokens), Math.min(deadline, Date.now() + 3000),
        async lateLease => { if ('release' in lateLease) await lateLease.release(); });
      if ('retryAfterMs' in lease) { retryAfterMs = Math.min(retryAfterMs, lease.retryAfterMs); continue; }
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new ProviderFailure('deadline-exceeded', true);
        const started = Date.now();
        const result = await this.callProvider(route, request, Math.min(remaining, route.timeoutMs));
        console.info('AI generation', { provider: route.provider, model: route.model, elapsedMs: Date.now() - started,
          outputCharacters: result.text.length, ...result.usage });
        return { text: result.text, provider: route.provider, model: route.model };
      } catch (error) {
        lastError = error instanceof ProviderFailure ? error : new ProviderFailure('unavailable', true, 2000);
        console.warn('AI provider attempt failed', { provider: route.provider, model: route.model,
          code: lastError.code, status: lastError.status });
        if (!lastError.retryable) throw new HttpsError(lastError.code, 'AI could not process this request.');
        if (lastError.cooldownMs) {
          retryAfterMs = Math.min(retryAfterMs, lastError.cooldownMs);
          await beforeDeadline(this.budget.cooldown(route, lastError.cooldownMs), Math.min(deadline, Date.now() + 250)).catch(() => undefined);
        }
      } finally { await releaseBeforeDeadline(() => lease.release(), deadline); }
    }
    if (Date.now() >= deadline || lastError?.code === 'deadline-exceeded') {
      throw new HttpsError('deadline-exceeded', 'AI request timed out. Please try again.', { retryAfterMs: 2000 });
    }
    throw new HttpsError(lastError?.code || 'resource-exhausted', 'AI capacity is temporarily unavailable.',
      { retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : 5000 });
  }

  private async callProvider(route: AiRoute, request: AiRequest, timeoutMs: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const isGemini = route.provider === 'gemini';
    const url = isGemini ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.model)}:generateContent`
      : 'https://api.groq.com/openai/v1/chat/completions';
    const body = isGemini ? {
      contents: [{ role: 'user', parts: [{ text: request.prompt }, ...(request.image ? [{ inlineData: request.image }] : [])] }],
      generationConfig: { responseMimeType: 'application/json', temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
        ...(/^gemini-3\.5-flash-lite/.test(route.model) ? { thinkingConfig: { thinkingLevel: 'minimal' } }
          : /^gemini-3\./.test(route.model) ? { thinkingConfig: { thinkingLevel: 'low' } }
          : /^gemini-2\.5-flash/.test(route.model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        ...(request.responseSchema ? { responseJsonSchema: request.responseSchema } : {}) },
    } : {
      model: route.model, messages: [{ role: 'system', content: 'Return only a JSON object, without markdown.'
        + (request.responseSchema ? ` Match this JSON Schema exactly: ${JSON.stringify(request.responseSchema)}` : '') },
      { role: 'user', content: request.prompt }],
      response_format: { type: 'json_object' }, temperature: request.temperature,
      max_completion_tokens: request.maxOutputTokens,
      ...(route.model.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low' } : {}),
    };
    try {
      const response = await this.transport(url, { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(isGemini ? { 'x-goog-api-key': this.keys.gemini! }
          : { Authorization: `Bearer ${this.keys.groq}` }) }, body: JSON.stringify(body) });
      if (!response.ok) {
        // Cancel error bodies: never log provider payloads, which may echo user content or credentials.
        await response.body?.cancel();
        const status = response.status;
        if (status === 429) throw new ProviderFailure('resource-exhausted', true, parseRetryAfter(response.headers.get('retry-after')) || 60000, status);
        if ([401, 403, 404].includes(status)) throw new ProviderFailure('failed-precondition', true, 300000, status);
        if (status === 408 || status >= 500) throw new ProviderFailure('unavailable', true, 10000, status);
        throw new ProviderFailure('failed-precondition', false, 0, status);
      }
      // Bound response memory even if an upstream returns an unexpectedly large JSON body.
      const reader = response.body?.getReader();
      if (!reader) throw new ProviderFailure('unavailable', true);
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 512 * 1024) { await reader.cancel(); throw new ProviderFailure('unavailable', true); }
        chunks.push(chunk.value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const candidate = data.candidates?.[0];
      const choice = data.choices?.[0];
      if (isGemini ? data.promptFeedback?.blockReason || ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY'].includes(candidate?.finishReason)
        : choice?.message?.refusal || choice?.finish_reason === 'content_filter') {
        throw new ProviderFailure('permission-denied', false);
      }
      if ((isGemini && candidate?.finishReason !== 'STOP') || (!isGemini && choice?.finish_reason !== 'stop')) {
        throw new ProviderFailure('unavailable', true); // Includes truncated output; never cache partial JSON.
      }
      const text = isGemini ? (candidate?.content?.parts || []).filter((part: any) => part.thought !== true)
        .map((part: any) => part.text || '').join('').trim() : choice?.message?.content?.trim();
      if (typeof text !== 'string' || !text || text.length > 128000) throw new ProviderFailure('unavailable', true);
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new ProviderFailure('unavailable', true); }
      if (parsed === null || typeof parsed !== 'object' || (request.responseSchema && !matchesAiSchema(parsed, request.responseSchema))) {
        throw new ProviderFailure('unavailable', true);
      }
      const usage = isGemini ? { inputTokens: data.usageMetadata?.promptTokenCount, outputTokens: data.usageMetadata?.candidatesTokenCount,
        reasoningTokens: data.usageMetadata?.thoughtsTokenCount } : { inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens, reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens };
      return { text, usage };
    } catch (error) {
      if (controller.signal.aborted) throw new ProviderFailure('deadline-exceeded', true, 2000);
      if (error instanceof ProviderFailure) throw error;
      throw new ProviderFailure('unavailable', true, 2000);
    } finally { clearTimeout(timer); }
  }
}
