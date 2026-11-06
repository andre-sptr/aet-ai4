function enabled(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env[name] ?? '').trim().toLowerCase());
}

/** V2 remains opt-in until regression and shadow comparisons pass. */
export const AI_ROUTER_V2 = enabled('AI_ROUTER_V2');
export const AI_SEMANTIC_CLASSIFIER = enabled('AI_SEMANTIC_CLASSIFIER');

/** Deterministic prompt preparation is opt-in until context and output regressions pass. */
export const AI_PROMPT_PREPARATION = enabled('AI_PROMPT_PREPARATION');

/** Adaptive multi-model execution is opt-in; legacy orchestration remains the default. */
export const AI_MULTI_MODEL_ORCHESTRATION = enabled('AI_MULTI_MODEL_ORCHESTRATION');

/** Domain-aware evaluation and quality gate for adaptive orchestration. */
export const AI_QUALITY_EVALUATION = enabled('AI_QUALITY_EVALUATION');
