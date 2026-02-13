export type DebugMessage = {
  id: string;
  ts: string;
  source: string;
  message: string;
};

const MAX_LOGS = 40;
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
let logs: DebugMessage[] = [];
const listeners = new Set<(messages: DebugMessage[]) => void>();
const lastByKey = new Map<string, number>();

const notify = () => {
  listeners.forEach((listener) => listener(logs));
};

export const addDebugMessage = (source: string, message: string) => {
  const key = `${source}|${message}`;
  const now = Date.now();
  const last = lastByKey.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return;
  lastByKey.set(key, now);

  logs = [
    { id: `${now}_${Math.random().toString(36).slice(2, 6)}`, ts: new Date().toISOString(), source, message },
    ...logs,
  ].slice(0, MAX_LOGS);
  notify();
};

export const subscribeDebugMessages = (listener: (messages: DebugMessage[]) => void) => {
  listeners.add(listener);
  listener(logs);
  return () => {
    listeners.delete(listener);
  };
};

export const clearDebugMessages = () => {
  logs = [];
  lastByKey.clear();
  notify();
};
