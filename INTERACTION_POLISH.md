# AET AI — Interaction Polish (Stage 3)

## Scope
This refinement improves the chat interaction layer while preserving the existing API contract, SSE event protocol, conversation schema, persona selection, and browser-local conversation persistence.

## Changes
- Streaming messages now show an inline active-state badge, animated response indicator before the first token, and a subtle caret while tokens are arriving.
- The conversation viewport follows new streamed content only while the user remains near the bottom. Scrolling upward pauses auto-follow so long answers can be read without being pulled down.
- The Stop action has a distinct visual state and continues to abort the existing `AbortController`; interrupted answers remain marked incomplete and excluded from subsequent model context.
- Retry continues to use the last user message and earlier completed context via the existing `retryMessages` helper.
- Copy now uses the Clipboard API with a legacy browser fallback and visible success/failure feedback.
- Completed assistant responses expose accessible helpful / not-helpful controls with `aria-pressed` state. This is currently local UI feedback only; it is not sent to the server because the existing API does not define a feedback endpoint.
- Added a regression test for copy confirmation and feedback state toggling.

## Validation
- TypeScript TSX transpilation/syntax check: passed for the changed component and test file.
- CSS brace balance: passed.
- Full unit tests and Next.js production build: not run. Dependency installation timed out in this environment, and the project declares Node.js >=24 while the available runtime is Node.js 22.16.0.

## Files changed
- `apps/web/components/chat/ChatWorkspace.tsx`
- `apps/web/components/chat/chat.css`
- `apps/web/tests/chat.test.tsx`
