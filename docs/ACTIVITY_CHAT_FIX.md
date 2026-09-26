# Activity chat sending fix — 2026-09-26

The deployed Firestore rules did not contain `activity_chats`, although the local
`firestore.rules` already did. The default deny rule therefore rejected both
opening a thread and saving messages. The screen did not surface those errors.

## Live backend fix

At 19:18 UTC, the existing local `activity_chats` rules were added to the currently
deployed rules in `coffeeradar-415f2`. All other live rules were preserved exactly.
The published ruleset and its content hash were read back and verified.

- Release: `projects/coffeeradar-415f2/releases/cloud.firestore`
- New ruleset: `776cb64a-6eb2-47f0-945d-6c5043040ca0`
- Previous ruleset: `0ccc1ca4-69a3-4608-a042-9abd3fcea6df`
- Published SHA-256: `018b0bb32192909063a3074f1ce0531155cc8fccd1cd483c61fa9c5486070d40`
- Local deployment evidence and backup: `.expo/chat-fix/`

Existing app installations can use the backend fix after reopening the chat;
no app update is needed for the missing permissions.

## Client changes in the workspace

The chat waits for authentication and initialization, exposes connection and send
errors with retry, retains failed drafts, prevents duplicate sends, and enforces
the 1,000-character message limit. It uses the stored expiration consistently and
cleans up listeners when leaving. Keyboard avoidance covers the conversation and
composer, with bottom safe-area padding.

These client changes have not been published as an OTA update or native build.

## Verification

- Firebase Rules API: compilation passed; 4 checks reproduced the old denial,
  and 18 checks validated the added rules, including valid sends, ownership,
  authentication, message limits, and rejection of message edits.
- `node --test scripts/activity-chat-service.test.cjs scripts/activity-chat-screen.test.cjs`:
  31 tests passed.
- `npx tsc --noEmit`: passed.
- Scoped `git diff --check`: passed.

Rule evaluation used synthetic request contexts without creating live users or
messages. Sending from a physical device was not exercised in this session.
