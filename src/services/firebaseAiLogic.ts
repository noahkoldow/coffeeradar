import { httpsCallable } from 'firebase/functions';
import { auth, ensureAuth, functions } from './firebase';
import { ensureCoreAiConsent } from './aiConsent';

type FirebaseAiImageInput = {
  mimeType: string;
  data: string;
};

type FirebaseAiJsonRequest = {
  prompt: string;
  model?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  image?: FirebaseAiImageInput;
  responseSchema?: unknown;
};

export const generateJsonWithFirebaseAiLogic = async (request: FirebaseAiJsonRequest): Promise<string> => {
  const userId = await ensureAuth();
  if (!await ensureCoreAiConsent()) {
    throw Object.assign(new Error('AI processing is disabled. You can enable it in Settings.'), {
      code: 'functions/permission-denied',
    });
  }
  const requireSameUser = () => {
    if (auth.currentUser?.uid !== userId) {
      throw Object.assign(new Error('The account changed. Please try again.'), { code: 'functions/unauthenticated' });
    }
  };
  requireSameUser();
  const timeoutMs = typeof request.timeoutMs === 'number' && Number.isFinite(request.timeoutMs)
    ? Math.min(25000, Math.max(1000, Math.floor(request.timeoutMs)))
    : 20000;
  // Keep the shared client API stable; provider/model selection and retries belong
  // to the server so old model hints cannot override its cost and capacity policy.
  const payload = {
    prompt: request.prompt,
    timeoutMs,
    ...(request.temperature != null ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens != null ? { maxOutputTokens: request.maxOutputTokens } : {}),
    ...(request.responseSchema != null ? { responseSchema: request.responseSchema } : {}),
    ...(request.image != null ? { image: request.image } : {}),
  };
  const generate = httpsCallable<typeof payload, { text: string }>(
    functions,
    'generateAiJson',
    { timeout: timeoutMs + 15000 },
  );
  // Let Firebase errors retain their code/details for callers' retry decisions.
  const result = await generate(payload);
  requireSameUser();
  const text = typeof result.data?.text === 'string' ? result.data.text.trim() : '';
  if (!text) {
    throw new Error('AI backend returned an empty response.');
  }

  return text;
};
