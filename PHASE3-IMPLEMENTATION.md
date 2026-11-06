# AET Adaptive Multi-model Orchestration — Phase 3

## Scope
Phase 3 adds an opt-in, bounded sequential orchestration pipeline:
planner -> up to two task-specialized generators -> reviewer -> optional one revision.

It preserves the existing Sumopod provider, Fastify API, SSE event contract, prompt preparation, tools, legacy orchestration, and existing Fast/Normal/Think settings.

## Activation
Set these backend environment variables:

```env
AI_ROUTER_V2=true
AI_MULTI_MODEL_ORCHESTRATION=true
```

`AI_SEMANTIC_CLASSIFIER` and `AI_PROMPT_PREPARATION` remain independently configurable. The new pipeline only runs for complex requests with effort `normal` or `think`, and only when at least four model calls remain in the existing strategy budget. Fast requests and all other requests use the existing orchestration path.

## Execution bounds
- Planner: one call.
- Generator: at most two calls, one per validated subtask.
- Reviewer: one call.
- Reviser: at most one additional call, only if the strategy budget has room.
- Planner output is strict JSON, max two subtasks, title max 120 characters, instruction max 1,600 characters.
- Invalid planner output falls back to one whole-task generation.
- Invalid reviewer JSON does not trigger revision.
- All provider calls use the shared request AbortSignal.
- A retryable provider failure may switch once to another eligible candidate before any answer is emitted; each retry consumes the same model-call budget.
- The pipeline buffers its draft and emits one final `delta` only after review/revision, preventing partial output from being followed by a replacement.

## Model selection
The planner, each generator, reviewer, and (when needed) reviser choose a model independently using the existing `selectModelsHybrid` capability/context/vision constraints. The reviewer prefers a model different from the last generator, but safely falls back to an eligible candidate if only one is available. Subtask outputs are concatenated without injecting headings so the user's requested output format is not silently changed.

Important: production model candidates still come from the configured `MODEL_CATALOG` (currently the three configured IDs in `models.ts`). The Sumopod `/v1/models` discovery helper lists account-visible IDs but does not establish vision, context, price, or task capabilities and does not automatically activate those IDs. Additional models must be explicitly configured and verified before being used for routing.

## Tests
`apps/api/test/ai-adaptive-orchestration.test.ts` covers bounded planner output, review validation, multi-stage generation, model diversity, revision budget, provider fallback, and cancellation.

Run:
```powershell
npm run typecheck
npm test
```

## Rollback
Set `AI_MULTI_MODEL_ORCHESTRATION=false` and restart the API. The previous orchestration path remains intact.
