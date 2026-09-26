import { useSyncExternalStore } from 'react';
import { Alert, Platform } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { auth, ensureAuth, functions } from './firebase';
import { getPreferredLocale } from '../utils/time';

export const CORE_AI_CONSENT_VERSION = 'multi-provider-v1';
type ConsentStatus = 'unknown' | 'enabled' | 'disabled';
type ConsentReceipt = { userId: string; allowed: boolean | null; version: string | null; providers: string[] };
const cache = new Map<string, ConsentStatus>();
const reads = new Map<string, Promise<ConsentStatus>>();
const prompts = new Map<string, Promise<boolean>>();
const writes = new Map<string, Promise<void>>();
const pendingRevocations = new Set<string>();
const revisions = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const revisionFor = (uid: string) => revisions.get(uid) ?? 0;

export const getCoreAiNotice = (german = false): string => german
  ? 'Für KI-Vorschläge und Planung sendet Bits deine Anfragen, Präferenzen, Standort, Kalenderkontext und Aufgaben an Google Gemini oder, wenn aktiviert, Groq. Fotos, die du für den KI-Import auswählst, verarbeitet Google Gemini. Je nach Verfügbarkeit kann eine Textanfrage an beide Anbieter gesendet werden. KI ist die Grundlage für die Kernfunktionen von Bits. Ohne KI stehen personalisierte KI-Vorschläge, automatische KI-Planung und der KI-Fotoimport nicht zur Verfügung. Die App funktioniert dann nicht wie vorgesehen. Du kannst ablehnen und Funktionen ohne KI weiter nutzen. Unter Einstellungen > Datenschutz > KI-Datenschutz kannst du die Einwilligung jederzeit für zukünftige Anfragen widerrufen.'
  : 'For AI suggestions and planning, Bits sends your prompts, preferences, location, calendar context and tasks to Google Gemini or, when enabled, Groq. Photos you choose for AI import are processed by Google Gemini. A text request may be sent to both providers when retrying for availability. AI powers the core features of Bits. Without AI, personalized AI suggestions, automatic AI planning and AI photo import are unavailable. The app will not function as intended. You can decline and keep using features that do not rely on AI. Revoke consent for future requests at any time in Settings > Privacy > AI privacy.';

const assertSameUser = (uid: string) => {
  if (auth.currentUser?.uid !== uid) {
    throw Object.assign(new Error('The account changed. Please try again.'), { code: 'functions/unauthenticated' });
  }
};

const statusFromReceipt = (receipt: ConsentReceipt): ConsentStatus => {
  if (receipt.allowed === false) return 'disabled';
  return receipt.allowed === true
    && receipt.version === CORE_AI_CONSENT_VERSION
    && ['gemini', 'groq'].every(provider => receipt.providers.includes(provider))
    ? 'enabled' : 'unknown';
};

export const loadCoreAiConsent = async (): Promise<ConsentStatus> => {
  const uid = await ensureAuth();
  const cached = cache.get(uid);
  if (cached) return cached;
  const pending = reads.get(uid);
  if (pending) return pending;
  const revision = revisionFor(uid);
  const read = (async () => {
    const get = httpsCallable<{ userId: string }, ConsentReceipt>(functions, 'getCoreAiConsent', { timeout: 15000 });
    const result = await get({ userId: uid });
    assertSameUser(uid);
    if (result.data.userId !== uid) throw new Error('AI consent account mismatch.');
    // Do not let an earlier read overwrite a newer revocation or grant.
    if (revisionFor(uid) !== revision) return cache.get(uid) ?? 'unknown';
    const status = statusFromReceipt(result.data);
    cache.set(uid, status);
    notify();
    return status;
  })();
  reads.set(uid, read);
  try { return await read; } finally { if (reads.get(uid) === read) reads.delete(uid); }
};

const persistConsent = async (uid: string, allowed: boolean): Promise<void> => {
  assertSameUser(uid);
  const writeRevision = revisionFor(uid) + 1;
  revisions.set(uid, writeRevision);
  // Stop new local requests immediately when revoking, including while offline.
  if (!allowed) {
    pendingRevocations.add(uid);
    cache.set(uid, 'disabled');
    notify();
  }
  const previous = writes.get(uid);
  const write = (async () => {
    if (previous) await previous.catch(() => undefined);
    assertSameUser(uid);
    const set = httpsCallable<{ userId: string; allowed: boolean; version: string }, ConsentReceipt>(
      functions, 'setCoreAiConsent', { timeout: 15000 },
    );
    const result = await set({ userId: uid, allowed, version: CORE_AI_CONSENT_VERSION });
    assertSameUser(uid);
    if (result.data.userId !== uid) throw new Error('AI consent account mismatch.');
    if (revisionFor(uid) === writeRevision) {
      cache.set(uid, statusFromReceipt(result.data));
      pendingRevocations.delete(uid);
      notify();
    }
  })();
  writes.set(uid, write);
  try { await write; } finally { if (writes.get(uid) === write) writes.delete(uid); }
};

export const setCoreAiConsent = async (allowed: boolean): Promise<void> => {
  const uid = await ensureAuth();
  await persistConsent(uid, allowed);
};

const showNotice = (german: boolean): Promise<boolean> => {
  const title = german ? 'KI-Funktionen aktivieren?' : 'Enable AI features?';
  const notice = getCoreAiNotice(german);
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${notice}`));
  }
  return new Promise(resolve => Alert.alert(title, notice, [
    { text: german ? 'Ablehnen' : 'Decline', style: 'cancel', onPress: () => resolve(false) },
    { text: german ? 'KI erlauben' : 'Allow AI', onPress: () => resolve(true) },
  ], { cancelable: false }));
};

const requestConsent = async (forcePrompt: boolean, german = getPreferredLocale().startsWith('de')): Promise<boolean> => {
  const uid = await ensureAuth();
  const pending = prompts.get(uid);
  if (pending) return pending;
  const revision = revisionFor(uid);
  const flow = (async () => {
    const status = await loadCoreAiConsent();
    assertSameUser(uid);
    if (revisionFor(uid) !== revision) return false;
    if (status === 'enabled') return true;
    if (status === 'disabled' && !forcePrompt) return false;
    const allowed = await showNotice(german);
    assertSameUser(uid);
    // A Settings revocation wins over a notice that was already open.
    if (revisionFor(uid) !== revision) return false;
    await persistConsent(uid, allowed);
    return allowed && cache.get(uid) === 'enabled';
  })();
  prompts.set(uid, flow);
  try { return await flow; } finally { if (prompts.get(uid) === flow) prompts.delete(uid); }
};

export const ensureCoreAiConsent = (): Promise<boolean> => requestConsent(false);
export const requestCoreAiConsent = (german?: boolean): Promise<boolean> => requestConsent(true, german);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  const unsubscribeAuth = auth.onAuthStateChanged(() => listener());
  return () => { listeners.delete(listener); unsubscribeAuth(); };
};
const snapshot = (): ConsentStatus => cache.get(auth.currentUser?.uid ?? '') ?? 'unknown';
export const useCoreAiConsent = (): ConsentStatus => useSyncExternalStore(subscribe, snapshot, snapshot);
const revocationSnapshot = (): boolean => pendingRevocations.has(auth.currentUser?.uid ?? '');
export const useCoreAiRevocationPending = (): boolean => useSyncExternalStore(subscribe, revocationSnapshot, revocationSnapshot);
