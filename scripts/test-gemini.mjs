// Standalone diagnostic script — verifies the Firebase AI Logic / Gemini connection
// works end-to-end with the same model + config the app uses, outside of Expo/RN.
// Run: node scripts/test-gemini.mjs
import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';

const firebaseConfig = {
  apiKey: 'AIzaSyAXbxWOx55fcf2b2dA03SCuHVbfeBxKrmc',
  authDomain: 'coffeeradar-415f2.firebaseapp.com',
  projectId: 'coffeeradar-415f2',
  storageBucket: 'coffeeradar-415f2.firebasestorage.app',
  messagingSenderId: '1056804480515',
  appId: '1:1056804480515:web:fe0e0e62f6ba0c4b50d036',
};

const MODEL = 'gemini-3.6-flash';

const runCase = async (label, { prompt, maxOutputTokens, responseSchema }) => {
  const app = initializeApp(firebaseConfig, `test-${label}-${Date.now()}`);
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, {
    model: MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.5,
      maxOutputTokens,
      thinkingConfig: { thinkingLevel: 'low' },
      ...(responseSchema ? { responseJsonSchema: responseSchema } : {}),
    },
  });

  console.log(`\n=== ${label}: PROMPT ===`);
  console.log(prompt);
  console.log(`(apiKey used: ${firebaseConfig.apiKey.slice(0, 12)}...${firebaseConfig.apiKey.slice(-4)}, same as src/services/firebase.ts)`);

  const start = Date.now();
  try {
    const result = await model.generateContent(prompt, { timeout: 20000 });
    const elapsedMs = Date.now() - start;
    const response = result.response;
    const finishReason = response?.candidates?.[0]?.finishReason;
    const text = response.text();
    console.log(`\n=== ${label} ===`);
    console.log('elapsedMs:', elapsedMs);
    console.log('finishReason:', finishReason);
    console.log('textLength:', text?.length ?? 0);
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.log('JSON PARSE FAILED:', e.message);
    }
    if (parsed) {
      console.log('parsed keys:', Object.keys(parsed));
      console.log(JSON.stringify(parsed, null, 2));
    }
    return { ok: true, finishReason, elapsedMs };
  } catch (error) {
    console.log(`\n=== ${label} ===`);
    console.log('ERROR:', error?.message ?? error);
    return { ok: false, error: String(error?.message ?? error) };
  }
};

const suggestionSchema = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          title: { type: 'string' },
          hook: { type: 'string' },
          cta: { type: 'string' },
          description: { type: 'string' },
          whyNow: { type: 'string' },
          durationMin: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          moodFit: { type: 'array', items: { type: 'string' } },
          emojis: { type: 'array', items: { type: 'string' } },
          isRepetitionFriendly: { type: 'boolean' },
          openStatus: { type: 'string' },
          opensInMin: { type: 'number' },
          closesInMin: { type: 'number' },
          placeName: { type: 'string', nullable: true },
          placeAddress: { type: 'string', nullable: true },
          placeLat: { type: 'number', nullable: true },
          placeLng: { type: 'number', nullable: true },
        },
        required: ['type', 'title', 'description', 'durationMin'],
      },
    },
  },
  required: ['suggestions'],
};

const guideSchema = {
  type: 'object',
  properties: { steps: { type: 'array', items: { type: 'string' } } },
  required: ['steps'],
};

const main = async () => {
  const results = [];

  results.push(['deck-2', await runCase('deck-generation (2 suggestions, all mode)', {
    maxOutputTokens: 4096,
    responseSchema: suggestionSchema,
    prompt: [
      'You are the user\'s sharp, well-informed friend deciding what to do right now.',
      'Local time: 18:30 Friday. Location: Berlin, Germany. Free window: 90 minutes.',
      'Interests: coffee, reading, board games. Lifestyle: chill.',
      'Return EXACTLY 2 suggestions, well-fitted, specific and time-appropriate.',
      'Output STRICT JSON only per schema: type, title, hook, cta, description, whyNow, durationMin, tags, confidence, moodFit, emojis, isRepetitionFriendly, openStatus/opensInMin/closesInMin, placeName/placeAddress/placeLat/placeLng (null for AT_HOME).',
    ].join('\n'),
  })]);

  results.push(['guide', await runCase('activity-guide (post-checklist-removal call)', {
    maxOutputTokens: 700,
    responseSchema: guideSchema,
    prompt: [
      'The user just pressed "Start" on this activity and needs a short, practical guide.',
      'Activity: Riverside Sunset Walk. Type: GO_OUT. Duration: 30 minutes.',
      'Write 3-6 short, concrete steps. Output STRICT JSON only: { "steps": ["..."] }',
    ].join('\n'),
  })]);

  results.push(['challenge', await runCase('challenge-mode (5 missions)', {
    maxOutputTokens: 4096,
    responseSchema: suggestionSchema,
    prompt: [
      'Generate CHALLENGE MODE cards only. Output ONLY real challenges with measurable success criteria.',
      'Local time: 18:30 Friday. Location: Berlin. Time window: 90 minutes.',
      'Return exactly 5 challenge missions mixing difficulty (easy/medium/hard) and social/fitness/short-term/long-term.',
      'Output STRICT JSON only per schema.',
    ].join('\n'),
  })]);

  console.log('\n\n=== SUMMARY ===');
  for (const [label, r] of results) {
    console.log(label, '->', r.ok ? `OK (${r.finishReason}, ${r.elapsedMs}ms)` : `FAILED: ${r.error}`);
  }
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
