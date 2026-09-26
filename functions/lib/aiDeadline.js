"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.beforeDeadline = beforeDeadline;
exports.releaseBeforeDeadline = releaseBeforeDeadline;
const https_1 = require("firebase-functions/v2/https");
/** Firestore operations cannot be cancelled; release any admission that arrives after its caller timed out. */
function beforeDeadline(pending, deadline, onLateResult) {
    return new Promise((resolve, reject) => {
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            reject(new https_1.HttpsError('deadline-exceeded', 'AI request timed out. Please try again.', { retryAfterMs: 2000 }));
        }, Math.max(0, deadline - Date.now()));
        pending.then(value => {
            clearTimeout(timer);
            if (timedOut) {
                void Promise.resolve().then(() => onLateResult?.(value)).catch(() => undefined);
                return;
            }
            resolve(value);
        }, error => { clearTimeout(timer); if (!timedOut)
            reject(error); });
    });
}
/** Cleanup must not discard an already-paid result. Lease expiry is the crash/frozen-instance fallback. */
async function releaseBeforeDeadline(release, deadline) {
    await beforeDeadline(Promise.resolve().then(release), Math.min(deadline, Date.now() + 250)).catch(() => undefined);
}
