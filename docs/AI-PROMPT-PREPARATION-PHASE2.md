# AET AI — Phase 2: Prompt Preparation Engine

## Scope

Phase 2 adds a deterministic prompt-preparation layer while preserving the existing chat request, provider, orchestration, and SSE contracts.

### Modules

- `apps/api/src/ai/prompting/prompt-builder.ts`: composes the prepared provider message list.
- `apps/api/src/ai/prompting/prompt-optimizer.ts`: adds task-specific guidance without rewriting the user's original request.
- `apps/api/src/ai/prompting/context-manager.ts`: converts attachments and retains the newest complete conversation turns within a character budget.
- `apps/api/src/ai/prompting/types.ts`: prompt preparation result and metrics contracts.
- `apps/api/src/ai/models/sumopod-discovery.ts`: authenticated reader for the OpenAI-compatible Sumopod `GET /v1/models` endpoint. It returns model IDs only and intentionally does not infer capabilities, prices, context sizes, or availability.

## Feature flag

```env
AI_PROMPT_PREPARATION=false
```

Keep this disabled for the first rollout. Enable it in a test environment after regression tests pass. It does not make an additional LLM call; optimization is deterministic.

## Context behavior

- The latest user turn is mandatory and is never silently truncated.
- Older conversation turns are removed as complete turns, oldest first.
- Image payloads remain attached to the corresponding message and are not counted as text characters.
- Extracted document text is counted against the context budget.
- If the system prompt plus latest user turn cannot fit, the engine returns a controlled `PROMPT_CONTEXT_LIMIT` error rather than silently deleting user content.
- A system note is added when older messages were omitted, if that note fits the remaining budget.

The budget uses the model's configured `maxContextCharacters` as an application-level safety approximation. It is not a tokenizer-based token count. Exact token accounting should be added only when Sumopod publishes reliable tokenizer/context metadata per model.

## Sumopod model discovery

`fetchSumopodModelIds()` calls `https://ai.sumopod.com/v1/models` with `Authorization: Bearer <SUMOPOD_API_KEY>`. The endpoint requires credentials. The parser validates the OpenAI-compatible `{ data: [{ id }] }` shape, bounds response size, deduplicates IDs, and returns IDs only. It does not automatically activate models in routing.

## Rollout

1. Run `npm run typecheck` and `npm test`.
2. Keep `AI_PROMPT_PREPARATION=false` and verify the legacy chat path.
3. Enable `AI_PROMPT_PREPARATION=true` in a test environment.
4. Test general, writing, research, coding, math, document, and image requests.
5. Test long conversation trimming and oversized latest-message rejection.
6. Compare outputs and latency before enabling in production.

## Compatibility

No database migration is required. No frontend change is required. No provider request format or SSE event name is changed. Existing `messagesFor()` remains the fallback when the feature flag is disabled.
