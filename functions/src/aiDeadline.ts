import { HttpsError } from 'firebase-functions/v2/https';

/** Firestore operations cannot be cancelled; release any admission that arrives after its caller timed out. */
export function beforeDeadline<T>(pending: Promise<T>, deadline: number,
  onLateResult?: (value: T) => Promise<unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new HttpsError('deadline-exceeded', 'AI request timed out. Please try again.', { retryAfterMs: 2000 }));
    }, Math.max(0, deadline - Date.now()));
    pending.then(value => {
      clearTimeout(timer);
      if (timedOut) { void Promise.resolve().then(() => onLateResult?.(value)).catch(() => undefined); return; }
      resolve(value);
    }, error => { clearTimeout(timer); if (!timedOut) reject(error); });
  });
}

/** Cleanup must not discard an already-paid result. Lease expiry is the crash/frozen-instance fallback. */
export async function releaseBeforeDeadline(release: () => Promise<void>, deadline: number): Promise<void> {
  await beforeDeadline(Promise.resolve().then(release), Math.min(deadline, Date.now() + 250)).catch(() => undefined);
}
