# AI routing: evaluation and operations

Research checked **24 September 2026**. The Gemini route and five AI/consent callables are now deployed in `coffeeradar-415f2`. The existing Gemini credential was copied directly into Secret Manager's `AI_PROVIDER_KEYS` and verified without storing it in source or app configuration. Groq is not configured. These are conservative pilot controls, not proven capacity for thousands of concurrent requests.

**Current iOS update:** the original AI release below was superseded at 11:14 UTC by [corrective update `d2e1125b-fc6a-4cd0-84e1-2c269d27b090`](https://expo.dev/accounts/noehxpo/projects/bits/updates/d2e1125b-fc6a-4cd0-84e1-2c269d27b090), containing login persistence, signed admin-role refresh, and a planner request-loop fix. It was exported with dependencies pinned to the installed native build's lockfile. All 28 delivered assets were hash-verified. See `IOS_RELIABILITY_FIX.md` and `IOS_RELIABILITY_RELEASE.json`; the reported native crash cause is not yet confirmed.

Live verification passed: authenticated generation returned valid JSON in approximately 1.6 seconds, and revoking consent blocked reuse of the result. The synthetic test account and its consent/quota documents were removed. See `AI_ROUTING_LIVE_CHECK.json` for the check results.

After explicit user approval, the AI-only iOS update was published on 24 September 2026 at 10:37 UTC to the `production` channel, runtime `1.0.0`: [EAS update group `71b6c154-368e-4e62-bbdc-610bd4847f95`](https://expo.dev/accounts/noehxpo/projects/bits/updates/71b6c154-368e-4e62-bbdc-610bd4847f95). The channel routes 100% to the production branch. The public update endpoint serves the new update, and all 28 assets were downloaded using Expo's supplied asset headers and verified against their hashes. The served JavaScript bundle matches the isolated, reviewed export. See `AI_ROUTING_IOS_RELEASE.json` for release and verification details.

This update is compatible with the reviewed TestFlight builds 11 and 12; it does not require a new native build. The release contains only the ten AI client/consent files from the isolated checkout, excluding unrelated workspace changes. Installed apps must download and apply the update before using the new endpoint. On-device application and complete user flows have not been verified: launch with internet access, allow the update to download, then fully close and reopen the app.

The live Firestore rules differed from this repository's rules. Deployment applied only the consent-write restriction to the existing live rules, preserving all other production rules. Do not deploy the full repository rules file without separately reviewing that difference.

## Recommendation and costs

Use one server-owned endpoint, keep Gemini for image requests, and optionally enable Groq for text. Route by supported capability and the configured preference order; fail over only within a bounded request deadline. Multiple providers can reduce dependence on one service, but each needs enough approved capacity for its assigned traffic and any promised failover load.

Free tiers are useful for development. They cannot support sustained thousands of simultaneous generations. Additional API keys do not create additional project or organization quota. Do not rotate free keys or accounts to evade limits.

The following list prices are USD for synchronous inference. The example assumes **10,000 requests, each with 2,000 input tokens and 300 output tokens**. It excludes additional reasoning tokens, retries, grounding/tool charges, taxes, Cloud Functions, Firestore, network transfer, logging, and other infrastructure.

| Provider and model | Input / million tokens | Output / million tokens | Example / 10,000 calls | Decision |
| --- | ---: | ---: | ---: | --- |
| Gemini `gemini-3.5-flash-lite` | $0.30 | $2.50 | $13.50 | Default; stable multimodal model with structured output support. |
| Gemini `gemini-2.5-flash-lite` | $0.10 | $0.40 | $3.20 | Consider only if this project's existing account retains access. |
| Groq `openai/gpt-oss-20b` | $0.075 | $0.30 | $2.40 | Optional text provider; evaluate task accuracy and actual reasoning-token usage. |
| Cloudflare `@cf/meta/llama-3.1-8b-instruct-fp8-fast` | $0.045 | $0.384 | $2.05 | Evaluated, not integrated; another platform and compatibility assessment would be required. |

Rates: [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Groq models and pricing](https://console.groq.com/docs/models), [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/). These are illustrative token costs, not a monthly budget forecast or measured cost per successful task.

Google now limits 2.5 model access to customers who actively used those models before; new projects are directed to current models. Both listed Gemini models accept images and support structured output. Do not configure 2.5 solely because its price is lower: verify access first. [Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite), [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)

Groq hosts the open-weight `openai/gpt-oss-20b` model; requests go to Groq, and no OpenAI API account is involved. It is a text route. Groq documents strict JSON Schema support, but that requires a specific schema subset. This adapter uses JSON-object mode, includes the requested schema in the prompt, and validates the returned data locally; it does not enable Groq's strict schema mode. Provider support is not evidence that generated facts are correct. [Groq structured outputs](https://console.groq.com/docs/structured-outputs)

Historical recommendations need rechecking: Groq's Llama 3.1 8B and Llama 3.3 70B entries now require enterprise pricing. Its current documented vision model, preview `qwen/qwen3.8-27b`, costs $0.80 input / $4.00 output per million tokens. The router therefore does not send images to Groq. [Groq model catalog](https://console.groq.com/docs/models), [Groq vision](https://console.groq.com/docs/vision/)

Cloudflare offers 10,000 free neurons per day, equivalent to roughly $0.11 at the listed neuron rate; more usage needs a paid plan. Its ordinary text-generation default is 300 RPM. Its documented JSON-mode list does not include the exact cheap `fp8-fast` model above, and schema generation can fail. It is not a drop-in capacity solution. [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [limits](https://developers.cloudflare.com/workers-ai/platform/limits/), [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)

Cerebras was also evaluated. It now documents a $5, 30-day trial requiring a verified payment method, with no recurring free tier. The public `gpt-oss-120b` developer quota is 1,000 RPM and 1M uncached TPM; account-specific quotas still need checking. Current pricing did not render reliably during this review, so no unverified price is quoted. [Cerebras limits and trial](https://inference-docs.cerebras.ai/support/rate-limits)

## Capacity: concurrent users are not provider throughput

For a sustained workload, average concurrent requests approximately equal requests per second multiplied by average request duration. Thus **1,000 active generations averaging 10 seconds need 100 requests/second, or 6,000 requests/minute**. At the example token sizes, that is **12M input tokens/minute plus 1.8M output tokens/minute**, before retries or reasoning. An occasional 1,000-request burst and 1,000 continuously active requests need different capacity plans.

Groq publishes a base developer quota of 1,000 RPM / 250K TPM for `gpt-oss-20b`. Its free quota is 30 RPM / 1,000 requests/day / 8K TPM / 200K tokens/day. At 2,300 tokens/request, 250K TPM accommodates only about 108 requests/minute before any additional reasoning; token capacity binds well before the listed RPM. Limits are organization-wide. [Groq models](https://console.groq.com/docs/models), [Groq limits](https://console.groq.com/docs/rate-limits)

Gemini quotas are project-wide, not per API key. Google directs operators to AI Studio for actual account/model limits and states that listed capacity is not guaranteed. Obtain approved paid quota or reserved capacity for the intended sustained and burst loads, plus headroom for failures, before advertising a concurrency target. [Gemini limits](https://ai.google.dev/gemini-api/docs/rate-limits)

The callable's `concurrency: 40` and `maxInstances: 50` describe an upper configuration envelope of 2,000 HTTP requests across instances. They do not prove 2,000 simultaneous upstream generations, reserve provider capacity, or override admission limits. Cold starts, CPU/memory, Firestore transaction contention, provider latency, and token quotas all affect real capacity. The initial deployment deliberately has much lower provider limits.

Photo traffic needs a separate memory assessment: 40 concurrent uploads of up to 4 MiB can put significant pressure on a 512 MiB instance once base64 strings and parsed JSON copies are included. Request parsing occurs before provider admission, so the Gemini pilot concurrency cap of 20 does not bound this memory pressure. High-volume image concurrency has not been benchmarked. If vision traffic is material, measure it and lower HTTP concurrency, increase memory, or separate the image endpoint; the 2,000-request configuration is not an image-processing capacity claim.

Concurrent 4 MB photo uploads require extra memory for base64 and JSON copies, including before provider admission. The 512 MiB instance setting has not been benchmarked for a photo-heavy workload. Lower HTTP concurrency or separate image processing and tune memory before scaling vision traffic.

## Implemented request path

The client helper in `src/services/firebaseAiLogic.ts` keeps its existing interface but calls `generateAiJson`. Clients do not select a provider, model, key, URL, or retry chain. An old model hint passed into the helper no longer changes the backend policy.

1. Authenticate and obtain the current AI-processing consent. First use displays a notice covering Google Gemini and optional Groq. Acceptance/revocation is stored through `setCoreAiConsent`, and read through `getCoreAiConsent`. The current notice version is `multi-provider-v1`.
2. Validate the request, optional image, and bounded response-schema subset on the server. A supplied schema must have an object root. Its nested schema subset covers simple types, properties, items, required fields, enum values, nullability, and supported bounds; arbitrary references, regular expressions, and combinators are rejected.
3. Apply the per-user budget and provider admission controls. Local 30-second result caching and identical in-flight request coalescing are scoped by user, not shared between users.
4. Select eligible configured routes in order. Image requests use Gemini only. Make at most two sequential provider attempts within a shared server generation deadline capped at 25 seconds; do not broadcast every request to every provider.
5. Parse the JSON and validate it against the supplied supported schema before returning the existing `{ text }` result shape.

The memory cache and coalescing operate within one warm function instance. Completed image results are not cached, though simultaneous identical image requests can share in-flight work. They are not durable, shared across instances, or a guarantee that all duplicate calls avoid billing. Consent is checked before response reuse. Failed or timed-out upstream attempts can still incur provider charges.

The router uses sharded Firestore admission state for provider RPM, estimated TPM, daily requests, and concurrent leases, plus cooldown state. These are application controls, not a provider reservation system or exact billing meter. Token estimates, fixed accounting windows, uneven shard distribution, requests from older clients, and traffic outside this router can all differ from the provider's view. Keep internal limits below verified available quota and expect conservative admission refusals. A paid model or higher `maxInstances` alone does not raise these controls.

Provider attempts, including failures, consume the admission counters. Admission reserves a conservative UTF-8 byte estimate of the prompt/schema, the maximum requested output, overhead, and an image allowance; it does not reconcile the reservation with billed usage. Each shard owns part of the total token budget, so one request must fit within one shard's share. The router probes at most two shards to limit database work under overload. Configure shard counts against both request size and measured contention. The provider state lives in `ai_provider_budgets` and `ai_provider_health`; per-user budgets live in `ai_quotas`.

Per-user defaults in `aiQuotaPolicy.ts` are 50 budgeted requests/day, or 100 with a valid server-verified premium entitlement; both have 6 requests/minute and 2 active requests. A cache hit or coalesced request avoids another user-budget acquisition. Once acquired, a request counts even when generation later fails or provider capacity is unavailable. The internal daily window is UTC. Active request leases expire after 45 seconds if cleanup fails. These safeguards limit one identity; account creation abuse still needs monitoring.

## Configuration

The source of truth is `functions/src/aiRouterConfig.ts`. Without `AI_ROUTER_ROUTES`, only Gemini is enabled:

| Setting | Pilot value |
| --- | --- |
| Model | `AI_GEMINI_MODEL`, then `GEMINI_MODEL`, otherwise `gemini-3.5-flash-lite` |
| Requests/minute | 60 |
| Estimated tokens/minute | 250,000 |
| Requests/day | 1,000 |
| Concurrent provider requests | 20 |
| Admission shards | 4 |
| Provider attempt timeout | 12,000 ms |

These values are intentionally small internal pilot limits, **not claimed free-tier allowances**. Lower them if the account has less quota. Inspect existing model environment variables so a stale `GEMINI_MODEL` does not silently select an unavailable model.

`AI_ROUTER_ROUTES` is nonsecret JSON containing one or two complete route objects. Each provider can occur once; its `id` must equal `gemini` or `groq`. Order is preference order, not weighted load balancing or live price discovery. Raising a field requires redeploying configuration. Changing the shard count also changes accounting allocation; make that change with traffic drained and provider counters checked.

Example for a **paid, quota-verified pilot** that prefers Groq for text and preserves Gemini for images/fallback:

```json
[
  { "id": "groq", "provider": "groq", "model": "openai/gpt-oss-20b", "rpm": 60, "tpm": 200000, "dailyRequests": 1000, "concurrency": 10, "shards": 2, "timeoutMs": 12000 },
  { "id": "gemini", "provider": "gemini", "model": "gemini-3.5-flash-lite", "rpm": 60, "tpm": 250000, "dailyRequests": 1000, "concurrency": 20, "shards": 4, "timeoutMs": 12000 }
]
```

Store ordinary configuration in `functions/.env.<PROJECT_ID>` using Firebase's supported environment-file mechanism. Encode the routes as a single JSON string value, for example `AI_ROUTER_ROUTES='[{...},{...}]'` with the complete objects above. Routes are read at runtime. Provider keys belong in the Secret Manager secret `AI_PROVIDER_KEYS`, not Expo environment variables, client code, environment files, or the route JSON. Its value is a JSON object with a `gemini` key and an optional `groq` key, each containing that provider's API credential. This one secret is bound to each AI callable, so a Gemini-only deployment does not need a separate empty Groq secret. Firebase documents environment files, secret binding, and secret redeployment requirements in [environment configuration](https://firebase.google.com/docs/functions/config-env?gen=2nd).

`generateAiJson` uses second-generation Functions in the client's default `us-central1` region, with 1 CPU, 512 MiB, concurrency 40, maximum 50 instances, minimum 0 instances, and a 60-second function timeout. The server generation deadline remains shorter. Any future region change must update both callable deployment and the client's Functions instance.

The server generation deadline starts before the consent read and is shared across user-budget acquisition, provider admission, generation, and waiting for coalesced results. Individual consent/admission waits are additionally capped at three seconds; cleanup and cooldown writes are awaited for at most 250 milliseconds within the remaining deadline. Provider HTTP calls receive an abort signal at their remaining deadline. These controls exclude client-side consent-dialog time, network transit, and platform scheduling; they are not a measured latency SLA. Firestore work cannot be cancelled: late admission results are released when possible, with lease expiry as the fallback if an instance stops. A cancelled upstream request can still be billable. Measure database tail latency and expired leases before increasing concurrency.

## Deployment runbook

The Gemini setup below has been completed for the existing project. These steps remain a reference for another environment or enabling Groq. No new provider account, billing plan, or live-load test was created. Confirm the intended Firebase project explicitly. Keep the initial rollout on Gemini unless Groq configuration, consent behavior, and task quality have been checked.

1. Verify Gemini model access and actual RPM/TPM/day limits in AI Studio. If enabling Groq, verify its model and account limits in Groq Console. Set route limits below capacity available after other consumers. Configure provider spend controls and billing alerts; estimated TPM and request caps do not impose an exact dollar ceiling.
2. Configure nonsecret route settings and install `AI_PROVIDER_KEYS`. Run from the repository root with the appropriate project identifier:

   ```powershell
   firebase functions:secrets:set AI_PROVIDER_KEYS --project <PROJECT_ID>
   ```

   Enter the JSON object through the secure secret-value prompt, or use Secret Manager's console. The following illustrates the shape only; replace placeholders privately and do not put real credentials into command arguments, tracked files, or documentation:

   ```json
   { "gemini": "<GEMINI_API_KEY>", "groq": "<OPTIONAL_GROQ_API_KEY>" }
   ```

   Omit `groq` completely for Gemini-only operation. Enabling Groq requires both a real `groq` credential in this secret and a Groq entry in `AI_ROUTER_ROUTES`. Updating the secret requires redeploying every consuming AI function. A legacy `GEMINI_API_KEY` secret does not by itself configure this router.

3. Build the Functions package and run the router/client tests included with the change. Resolve compilation or test failures before deployment:

   ```powershell
   npm --prefix functions run test:ai
   ```

4. Review the Firestore rules diff against the **currently deployed rules** and deploy only the affected callable functions. The live project has already received the narrow consent protection; deploying the whole repository rules file would also include unrelated changes:

   ```powershell
   $env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
   firebase deploy --project <PROJECT_ID> --only "functions:generateAiJson,functions:fetchExternalData,functions:polishCommunityIdea,functions:setCoreAiConsent,functions:getCoreAiConsent"
   ```

5. Verify the deployed runtime environment, the `AI_PROVIDER_KEYS` secret binding, model IDs, generation, region, and instance settings. A configured Groq route is not usable until its credential is present in the secret injected into that revision. Confirm the private quota/provider state and server-written consent records cannot be changed by ordinary clients. Firebase describes selected-function deployment and runtime options in [function management](https://firebase.google.com/docs/functions/manage-functions?gen=2nd).
6. Distribute the migrated client and consent flow through an OTA update when the installed native runtime is compatible; otherwise build a new TestFlight binary. The compatible iOS OTA release above has already been published. Test first-use acceptance, decline, revocation in Settings, account switching, text generation, image import, malformed JSON handling, and provider timeout/rate-limit behavior on a device. Deploying Functions alone does not replace installed application code.
7. Increase traffic in stages while measuring latency percentiles, error rates, route selection, fallback rate, cache effectiveness, actual tokens/cost per successful task, Firestore contention, and provider quota headroom. Test provider failure while the fallback is already carrying ordinary load. Agree on the observed sustainable request rate before increasing internal quotas.

The deployment names above are exported from `functions/src/index.ts`. `polishCommunityIdea` remains a first-generation callable with its own runtime settings, while its generation work shares the router. `fetchExternalData` retains its existing external-service secret bindings in addition to `AI_PROVIDER_KEYS`. Do not remove those existing secrets when configuring the new AI secret.

Authentication and budget checks are always required. App Check enforcement is configurable and defaults off. After integrating and verifying client attestation, set the actual runtime environment variable `ENFORCE_APP_CHECK=true` and redeploy the AI functions. The new gateway reads that variable directly; legacy `app.enforce_app_check` configuration is not a substitute, and any retained legacy setting must agree with it. Verify enforcement on both new and legacy AI callables. Enabling enforcement before supported clients supply valid App Check tokens will reject their requests. Authentication alone does not prevent account creation abuse or guarantee that calls originate from the distributed app.

## Existing installations and operational limits

**Old direct Firebase AI Logic binaries bypass this router.** Their calls are not governed by these server admission limits, consent checks, or routing preferences. Track migration and retire direct-client API access only after the supported installed clients have moved to the callable path; disabling it earlier can break AI features in old builds. Keep direct-client and server credentials/access controls distinguishable, so retiring the former does not disable the server's Gemini access.

Only the migrated AI paths receive these controls. Audit every remaining provider caller and legacy callable before claiming a project-wide cost ceiling. Calls to external place/event services have their own charges and quotas.

For a bad Groq rollout, restore a Gemini-only route configuration and redeploy the affected AI functions. For budget pressure, lower admission limits and investigate token usage, retries, and callers outside the gateway. Do not delete quota state to restore availability: that resets accounting without increasing upstream capacity. Existing in-flight work may finish or remain billable after a configuration change.

This initial design favors a small amount of operational complexity. A dedicated shared admission service, durable queue for deferrable work, more efficient distributed counters, and reserved provider capacity may be appropriate at measured scale. They are follow-up capacity decisions, not capabilities proven by the current code or by a local test.
