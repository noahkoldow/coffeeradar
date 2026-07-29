import { addDoc, collection, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where, Timestamp } from 'firebase/firestore';
import { db, firebaseEnabled } from './firebase';
import { generateJsonWithFirebaseAiLogic } from './firebaseAiLogic';

type ActivityRequest = {
  attributes?: string[];
  latLonBucket?: string;
  timeHints?: string[];
  minScore?: number;
  onlyVerified?: boolean;
  intentText?: string;
};

type ActivityDoc = {
  title: string;
  description: string;
  attributes: string[];
  time_tags: string[];
  geo_scope: string;
  request_key: string;
  ttl_expires_at?: Timestamp | null;
  verified?: boolean;
  usage_count?: number;
  deck_fit_count?: number;
  created_at?: Timestamp | null;
  updated_at?: Timestamp | null;
  last_used_at?: Timestamp | null;
  source_info?: {
    origin: 'DB' | 'AI';
    model?: string;
  };
};

const COLLECTION = 'activities';
const env = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env ?? {} : {};

function normalizeList(values: string[] = []) {
  return [...new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))].sort();
}

function normalizeScope(value?: string | null) {
  return String(value || 'global').trim().toLowerCase() || 'global';
}

function makeRequestKey(request: ActivityRequest) {
  const attributes = normalizeList(request.attributes || []);
  const timeHints = normalizeList(request.timeHints || []);
  const geo = normalizeScope(request.latLonBucket);
  return [attributes.join('|') || 'any', timeHints.join('|') || 'any', geo].join('::');
}

function scoreActivity(activity: ActivityDoc, request: ActivityRequest) {
  const wantedAttributes = normalizeList(request.attributes || []);
  const wantedTimeHints = normalizeList(request.timeHints || []);
  const activityAttributes = normalizeList(activity.attributes || []);
  const activityTimeTags = normalizeList(activity.time_tags || []);

  let score = 0;
  for (const attribute of wantedAttributes) if (activityAttributes.includes(attribute)) score += 2;
  for (const timeHint of wantedTimeHints) if (activityTimeTags.includes(timeHint)) score += 1;
  if (activity.geo_scope === 'global') score += 1;
  if (request.latLonBucket && activity.geo_scope === normalizeScope(request.latLonBucket)) score += 3;
  if (activity.verified) score += 0.5;
  score += Math.min(1.5, Math.log2((activity.usage_count ?? 0) + 1) / 2);
  return score;
}

function isExpired(activity: ActivityDoc) {
  return !!activity.ttl_expires_at && activity.ttl_expires_at.toMillis() <= Date.now();
}

function isTimeCriticalRequest(request: ActivityRequest, generated: any) {
  const tokens = [
    ...(request.attributes || []),
    ...(request.timeHints || []),
    String(request.intentText || ''),
    String(generated?.title || ''),
    String(generated?.description || ''),
  ]
    .join(' ')
    .toLowerCase();

  return /\b(event|tonight|today|now|soon|deadline|concert|show|screening|dinner|lunch|breakfast|meetup)\b/.test(tokens);
}

async function fetchBestDbMatch(request: ActivityRequest) {
  if (!firebaseEnabled || !db) return null;

  const requestKey = makeRequestKey(request);

  const exactQuery = query(
    collection(db, COLLECTION),
    where('request_key', '==', requestKey),
    limit(1),
  );
  const exactSnap = await getDocs(exactQuery);
  if (!exactSnap.empty) {
    const exactDoc = exactSnap.docs[0];
    const exactActivity = exactDoc.data() as ActivityDoc;
    if (!isExpired(exactActivity) && (!request.onlyVerified || exactActivity.verified)) {
      await updateDoc(doc(db, COLLECTION, exactDoc.id), {
        usage_count: (exactActivity.usage_count ?? 0) + 1,
        last_used_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      }).catch(() => undefined);
      return { id: exactDoc.id, activity: exactActivity, source: 'DB' as const, score: 100 };
    }
  }

  const wantedAttributes = normalizeList(request.attributes || []);
  const wantedTimeHints = normalizeList(request.timeHints || []);
  const queryCandidates: Array<ReturnType<typeof query>> = [];

  if (wantedAttributes.length) {
    queryCandidates.push(query(collection(db, COLLECTION), where('attributes', 'array-contains-any', wantedAttributes.slice(0, 10)), limit(50)));
  }
  if (wantedTimeHints.length) {
    queryCandidates.push(query(collection(db, COLLECTION), where('time_tags', 'array-contains-any', wantedTimeHints.slice(0, 10)), limit(50)));
  }
  if (request.latLonBucket) {
    queryCandidates.push(query(collection(db, COLLECTION), where('geo_scope', 'in', ['global', normalizeScope(request.latLonBucket)]), limit(30)));
  }
  queryCandidates.push(query(collection(db, COLLECTION), orderBy('usage_count', 'desc'), limit(25)));

  const attributeSnaps = await Promise.all(queryCandidates.map((candidateQuery) => getDocs(candidateQuery)));
  let best: { id: string; activity: ActivityDoc; source: 'DB'; score: number } | null = null;

  const seenIds = new Set<string>();
  for (const snap of attributeSnaps) {
    for (const docSnap of snap.docs) {
      if (seenIds.has(docSnap.id)) continue;
      seenIds.add(docSnap.id);
      const activity = docSnap.data() as ActivityDoc;
      if (isExpired(activity)) continue;
      if (request.onlyVerified && !activity.verified) continue;
      const score = scoreActivity(activity, request);
      if (!best || score > best.score || (score === best.score && (activity.usage_count ?? 0) > (best.activity.usage_count ?? 0))) {
        best = { id: docSnap.id, activity, source: 'DB', score };
      }
    }
  }

  if (best && best.score >= (request.minScore ?? 3)) return best;
  return null;
}

function buildPrompt(request: ActivityRequest) {
  return [
    'Return ONLY valid JSON.',
    'Schema: {"title":string,"description":string,"attributes":string[],"time_tags":string[],"geo_scope":string,"ttl_expires_at":string|null}',
    'Prefer reusable activities that can match similar future requests instead of one-off ideas.',
    `Intent: ${request.intentText || ''}`,
    `Attributes: ${(request.attributes || []).join(', ')}`,
    `Time hints: ${(request.timeHints || []).join(', ')}`,
    `Geo scope: ${request.latLonBucket || 'global'}`,
    'Do not include markdown or extra text.',
  ].join('\n');
}

function parseGeminiJson(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/\{[\s\S]*\}/m);
  const jsonText = match ? match[0] : trimmed;
  return JSON.parse(jsonText);
}

async function callGemini(request: ActivityRequest) {
  const prompt = buildPrompt(request);

  const text = await generateJsonWithFirebaseAiLogic({
    prompt,
    model: String(env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-3.6-flash').trim(),
    temperature: 0.4,
    timeoutMs: 20000,
    responseSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        attributes: { type: 'array', items: { type: 'string' } },
        time_tags: { type: 'array', items: { type: 'string' } },
        geo_scope: { type: 'string' },
        ttl_expires_at: { type: 'string' },
      },
      required: ['title', 'description'],
    },
  });
  if (!text) throw new Error('Gemini response missing text');
  return parseGeminiJson(text);
}

function ttlFromGenerated(activity: any, request: ActivityRequest) {
  if (activity?.ttl_expires_at) return new Date(activity.ttl_expires_at);
  if (isTimeCriticalRequest(request, activity)) return new Date(Date.now() + 6 * 60 * 60 * 1000);
  if (activity?.geo_scope && activity.geo_scope !== 'global') return new Date(Date.now() + 12 * 60 * 60 * 1000);
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

export async function findOrGenerateActivity(request: ActivityRequest) {
  const dbHit = await fetchBestDbMatch(request);
  if (dbHit) return { ...dbHit, activity: { ...dbHit.activity, source_info: { ...(dbHit.activity.source_info || {}), origin: 'DB' } } };

  const generated = await callGemini(request);
  const requestKey = makeRequestKey(request);
  const activity: ActivityDoc = {
    title: String(generated.title || '').trim(),
    description: String(generated.description || '').trim(),
    attributes: normalizeList(generated.attributes || request.attributes || []),
    time_tags: normalizeList(generated.time_tags || request.timeHints || []),
    geo_scope: String(generated.geo_scope || request.latLonBucket || 'global').trim(),
    request_key: requestKey,
    ttl_expires_at: Timestamp.fromDate(ttlFromGenerated(generated, request)),
    verified: false,
    usage_count: 1,
    deck_fit_count: 1,
    source_info: { origin: 'AI', model: env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-3.6-flash' },
  };

  const saved = await addDoc(collection(db!, COLLECTION), {
    ...activity,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    last_used_at: serverTimestamp(),
  });

  return {
    id: saved.id,
    source: 'AI' as const,
    score: 0,
    activity,
  };
}

export async function promoteActivityUsage(activityId: string, usageCount = 1) {
  if (!firebaseEnabled || !db) return;
  await updateDoc(doc(db, COLLECTION, activityId), {
    usage_count: usageCount,
    deck_fit_count: usageCount,
    updated_at: serverTimestamp(),
  });
}
