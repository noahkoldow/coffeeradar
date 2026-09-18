import { createHash } from 'crypto';

export const accountTokenForUid = (uid: string): string => {
  const hash = createHash('sha256').update(`bits-store-account:${uid}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

/** Evaluate only Apple-verified payloads; never call this with client-supplied transaction fields. */
export function evaluateVerifiedSubscription(transaction: {
  productId?: string; appAccountToken?: string; originalTransactionId?: string;
  expiresDate?: number; revocationDate?: number;
}, status: unknown, uid: string, productId: string, now: number, graceExpiresAt?: number) {
  if (transaction.productId !== productId) throw new Error('wrong-product');
  if (transaction.appAccountToken?.toLowerCase() !== accountTokenForUid(uid)) throw new Error('wrong-account');
  if (!transaction.originalTransactionId || !/^\d{1,40}$/.test(transaction.originalTransactionId)) throw new Error('missing-transaction');
  const expiresAtMs = status === 4 ? (graceExpiresAt || transaction.expiresDate || 0) : (transaction.expiresDate || 0);
  return { active: transaction.revocationDate == null && Number.isFinite(expiresAtMs) && expiresAtMs > now && (status === 1 || status === 4),
    expiresAtMs, originalTransactionId: transaction.originalTransactionId };
}

export async function lookupAppleEnvironment<T>(hint: unknown, lookup: (environment: 'Production' | 'Sandbox') => Promise<T>) {
  // StoreKit may omit environmentIOS. Only a store transaction-not-found response permits fallback.
  const first = hint === 'Sandbox' ? 'Sandbox' : 'Production';
  try { return { environment: first, response: await lookup(first) }; }
  catch (error) {
    const code = (error as { apiError?: number }).apiError;
    if (code !== 4040005 && code !== 4040010) throw error;
    const second = first === 'Production' ? 'Sandbox' : 'Production';
    return { environment: second, response: await lookup(second) };
  }
}
