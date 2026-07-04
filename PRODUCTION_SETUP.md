Production setup — Activities + Gemini (direct) integration

Overview
- Backend: Firebase Cloud Functions (Node/TypeScript) provide `findOrGenerateActivity`, `generateVoucher`, `redeemVoucher`, and `markActivityVerified` callables.
- Storage: Firestore collection `activities` stores generated items (server-created only). `vouchers` and `conversions` used for CPA flows.
- Model: direct Gemini HTTP API (set `models.api_url` and `models.api_key`).

Required configuration (Firebase functions config)
- `models.api_url` — the direct Gemini endpoint (HTTP POST). Example: `https://api.gemini.example/v1/generate`
- `models.api_key` — API key for direct Gemini API (Bearer token).
- `app.voucher_secret` — secret for signing voucher tokens.
- `app.admin_emails` — comma-separated admin emails allowed to call `markActivityVerified`.
- `vendors.api_keys` — comma-separated vendor API keys for server-to-server redemption (optional).

Vendor webhook
- The `vendorRedeem` Cloud Function exposes a POST endpoint that vendors can call to redeem vouchers server-to-server.
- Vendors must include an `x-vendor-key` header matching one of the keys in `vendors.api_keys`.

Set configuration (including voucher secret and vendor keys):
```bash
firebase functions:config:set \
  models.api_url="https://YOUR-GEMINI-ENDPOINT" \
  models.api_key="sk_YOUR_DIRECT_GEMINI_KEY" \
  app.voucher_secret="your_voucher_secret" \
  app.admin_emails="bitsapp.admin@gmail.com" \
  vendors.api_keys="vendorkey1,vendorkey2"
```

Set configuration:
```bash
firebase functions:config:set \
  models.api_url="https://YOUR-GEMINI-ENDPOINT" \
  models.api_key="sk_YOUR_KEY" \
  app.voucher_secret="your_voucher_secret" \
  app.admin_emails="bitsapp.admin@gmail.com"
```

Build & deploy
```bash
cd functions
npm install
npm run build
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

Client integration
- Use Firebase callable functions to request activities. Example payload for `findOrGenerateActivity`:
```js
{
  attributes: ['homebody','cozy','budget:$'],
  latLonBucket: '52.52,13.40',
  timeHints: ['tonight'],
  minScore: 3,
  onlyVerified: false,
  intentText: 'I want a quiet evening at home with coffee and a movie'
}
```
- The function returns `{ source: 'db'|'model', activity: {...}, score?, deduped? }`.
- Use `onlyVerified: true` when showing CPA/affiliate offers so only vetted `verified:true` activities are eligible.

Security notes
- `activities` creation is restricted to server-side code (Security Rules `allow create: if false`). Cloud Functions use the Admin SDK to write.
- `vouchers` and `conversions` are protected and should be created or written only by server-side flows.
- Monitor model call volume and set rate limits / quotas if needed.

Telemetry & monitoring
- Log model call outcomes, `source` (DB/AI), `usage_count`, and failure rates.
- Track cost per model call and conversions per voucher to measure ROI.

If you want, I can:
- Wire the exact parsing to a sample Gemini response (paste one HTTP response body)
- Integrate the admin screen into app navigation
- Add monitoring dashboards (Stackdriver / BigQuery export)
