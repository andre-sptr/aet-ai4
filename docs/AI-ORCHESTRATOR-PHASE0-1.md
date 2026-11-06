# AET Adaptive Intelligence Orchestrator — Phase 0 & Phase 1

## Scope

This change introduces an opt-in hybrid routing V2 alongside the existing router. It does not replace the existing orchestrator, Sumopod adapter, model IDs, tools, chat request schema, SSE event contract, frontend, or database schema.

## Phase 0 baseline

- Source audit completed for `apps/api/src/ai/{models,router,orchestrator,provider,routes}.ts` and `apps/api/test/ai-routing.test.ts`.
- Existing regression coverage includes request validation, task-aware routing, effort limits, vision compatibility, direct streaming, deterministic tools, provider fallback, partial-stream safety, cancellation, complex Think planning/review/revision, missing credentials, deadlines, and concurrency admission.
- Baseline test command: `npm test`.
- Baseline execution in the build environment was blocked before test discovery because dependencies were not installed (`Cannot find module 'zod'`). `npm ci` did not complete within the available execution window; offline installation confirmed at least one required tarball was not cached.
- Runtime in the build environment is Node `v22.16.0`, while the repository declares Node `>=24.0.0`. Re-run under the project's supported Node 24+ environment.

## Phase 1 implementation

### New modules

- `apps/api/src/ai/models/registry.ts`: derives runtime model profiles from the existing catalog; preserves current IDs and provider settings; availability remains `unknown` until explicitly verified; supports an operator kill-switch through `SUMOPOD_DISABLED_MODELS`.
- `apps/api/src/ai/routing/hybrid-router.ts`: heuristic task profile, confidence/ambiguity signals, optional semantic-classifier interface, validated semantic enrichment, capability/context/vision-constrained model selection, and routing decision diagnostics.
- `apps/api/src/ai/routing/feature-flags.ts`: opt-in feature flags.
- `apps/api/test/ai-routing-v2.test.ts`: focused tests for classifier enrichment, semantic-classifier gating/fallback, model registry, hard constraints, and task/effort-aware selection.

### Integration

`orchestrator.ts` uses the old router by default. When `AI_ROUTER_V2=true`, it uses V2 classification and model selection. When both `AI_ROUTER_V2=true` and `AI_SEMANTIC_CLASSIFIER=true`, low-confidence or multi-domain requests may use one bounded Sumopod classification call. The classification call counts against the existing model-call budget. If semantic classification fails or returns invalid data, the safe heuristic profile is retained. Cancellation/deadline signals are propagated.

### Environment variables

```env
AI_ROUTER_V2=false
AI_SEMANTIC_CLASSIFIER=false
SUMOPOD_DISABLED_MODELS=
```

- Keep both AI flags `false` for legacy behavior.
- Enable `AI_ROUTER_V2=true` for V2 heuristic routing.
- Enable `AI_SEMANTIC_CLASSIFIER=true` only together with V2 and after provider model access has been verified.
- `SUMOPOD_DISABLED_MODELS` accepts comma-separated exact model IDs. This is an operator kill-switch, not a live availability probe.

## Safety and compatibility

- No Prisma schema or database migration changes.
- No frontend changes or SSE event renaming/removal.
- Existing catalog is still the source of model IDs and provider-specific request fields.
- Unknown model availability is not represented as verified; unknown remains eligible for backward compatibility, while explicitly disabled/unavailable entries are excluded by V2 selection.
- Vision and context constraints remain hard constraints.
- Semantic classification is bounded to one call and cannot override vision compatibility, tool plans, attachment metadata, or safety constraints.
- Legacy behavior remains the default and can be restored by setting `AI_ROUTER_V2=false`.

## Verification commands

Run with Node 24+ and dependencies installed:

```bash
npm ci
npm run typecheck
npm test
```

Focused tests:

```bash
npx tsx --tsconfig tsconfig.test.json --experimental-test-module-mocks --test apps/api/test/ai-routing.test.ts apps/api/test/ai-routing-v2.test.ts
```

Before enabling V2 in production, verify all configured model IDs using the protected model-test endpoint and compare the old/new routing decisions on a fixed internal prompt set.
