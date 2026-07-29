import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import { app } from './firebase';

const env = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env ?? {} : {};

const DEFAULT_MODEL = String(
  env.EXPO_PUBLIC_GEMINI_MODEL
    || 'gemini-3.6-flash'
).trim() || 'gemini-3.6-flash';

const ai = getAI(app, { backend: new GoogleAIBackend() });

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
  const modelName = (request.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const timeoutMs = request.timeoutMs ?? 20000;
  const model = getGenerativeModel(ai, {
    model: modelName,
    generationConfig: {
      responseMimeType: 'application/json',
      ...(request.temperature != null ? { temperature: request.temperature } : {}),
      ...(request.topP != null ? { topP: request.topP } : {}),
      ...(request.topK != null ? { topK: request.topK } : {}),
      maxOutputTokens: request.maxOutputTokens ?? 4096,
      thinkingConfig: { thinkingLevel: 'low' },
      ...(request.responseSchema != null ? { responseJsonSchema: request.responseSchema as Record<string, unknown> } : {}),
    },
  });

  const content = request.image
    ? [
      { text: request.prompt },
      {
        inlineData: {
          mimeType: request.image.mimeType,
          data: request.image.data,
        },
      },
    ]
    : request.prompt;

  const result = await model.generateContent(content, { timeout: timeoutMs });
  const response = result.response;
  const finishReason = (response as any)?.candidates?.[0]?.finishReason;
  console.log('[Gemini] finishReason:', finishReason ?? 'unknown');

  const text = response.text().trim();
  if (!text) {
    throw new Error('Firebase AI Logic returned an empty response.');
  }

  return text;
};
