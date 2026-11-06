import type { ChatRequest, Effort } from '@aet/contracts';
import { AiError } from '../errors.js';
import { MODEL_CATALOG, type ModelSpec } from '../models.js';
import { classify, type Classification, type TaskType, type Strategy, strategyFor } from '../router.js';
import { getModelRegistry, isModelEligible, type CapabilityName, type RegisteredModel } from '../models/registry.js';

export type TaskProfile = Classification & {
  domain: string[];
  reasoningLevel: 'low' | 'medium' | 'high';
  accuracyRequirement: 'standard' | 'high' | 'critical';
  confidence: number;
  needsSemanticClassification: boolean;
};

export type SemanticClassification = Pick<TaskProfile, 'taskType' | 'complexity' | 'domain' | 'reasoningLevel' | 'accuracyRequirement' | 'needsTools' | 'needsVerification'>;
export type SemanticClassifier = (request: ChatRequest, heuristic: TaskProfile, signal?: AbortSignal) => Promise<Partial<SemanticClassification> | null>;

const domainPatterns: Array<[string, RegExp]> = [
  ['software-engineering', /\b(?:code|coding|program|typescript|javascript|python|sql|debug|api|database|arsitektur perangkat lunak)\b/i],
  ['research', /\b(?:research|penelitian|jurnal|literature|metode penelitian|hipotesis|referensi|sitasi)\b/i],
  ['quantitative', /\b(?:hitung|calculate|regresi|statistik|statistika|matematika|persamaan|data panel|ekonometrik)\b/i],
  ['academic-writing', /\b(?:makalah|skripsi|tesis|disertasi|artikel ilmiah|essay|esai|parafrase)\b/i],
  ['business', /\b(?:bisnis|business|strategi|pasar|keuangan|financial|akuntansi|manajemen)\b/i],
  ['security', /\b(?:security|keamanan|pentest|vulnerability|kerentanan|threat|audit keamanan)\b/i],
];

function confidenceFor(task: Classification, text: string): number {
  const signals = [
    task.taskType !== 'general',
    task.complexity !== 'simple',
    task.needsTools,
    task.needsVerification,
    task.requiredCapabilities.vision,
    text.length > 100,
  ].filter(Boolean).length;
  const conflicting = ['coding', 'math', 'research', 'writing'].filter(type => {
    const patterns: Record<string, RegExp> = {
      coding: /\b(?:code|coding|program|typescript|python|debug)\b/i,
      math: /\b(?:hitung|regresi|statistik|persamaan|matematika)\b/i,
      research: /\b(?:research|penelitian|jurnal|literature|referensi)\b/i,
      writing: /\b(?:tulis|write|essay|esai|makalah|skripsi|draft)\b/i,
    };
    return patterns[type]!.test(text);
  }).length;
  return Math.max(0.35, Math.min(0.98, 0.55 + signals * 0.07 - Math.max(0, conflicting - 1) * 0.12));
}

export function classifyHybridHeuristically(request: ChatRequest): TaskProfile {
  const legacy = classify(request);
  const text = request.messages.filter(message => message.role === 'user').slice(-4).map(message => message.content).join('\n');
  const domain = domainPatterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  const confidence = confidenceFor(legacy, text);
  const reasoningLevel = legacy.complexity === 'complex' ? 'high' : legacy.complexity === 'moderate' ? 'medium' : 'low';
  const critical = /\b(?:diagnosis|diagnosa|medis|legal|hukum|keselamatan|safety|financial advice|investasi)\b/i.test(text);
  const accuracyRequirement = critical ? 'critical' : legacy.needsVerification ? 'high' : 'standard';
  const multipleDomains = domain.length >= 2;
  return {
    ...legacy,
    domain,
    reasoningLevel,
    accuracyRequirement,
    confidence,
    needsSemanticClassification: (confidence < 0.62 && legacy.complexity !== 'simple') || multipleDomains || (legacy.taskType === 'general' && legacy.complexity === 'complex'),
  };
}

function validTaskType(value: unknown): value is TaskType {
  return ['general', 'writing', 'research', 'coding', 'math', 'document', 'image'].includes(String(value));
}

/** Apply only validated semantic fields; malformed classifier output is ignored. */
export async function classifyHybrid(request: ChatRequest, options: { semanticClassifier?: SemanticClassifier; signal?: AbortSignal } = {}): Promise<TaskProfile> {
  const heuristic = classifyHybridHeuristically(request);
  if (!heuristic.needsSemanticClassification || !options.semanticClassifier) return heuristic;
  try {
    options.signal?.throwIfAborted();
    const semantic = await options.semanticClassifier(request, heuristic, options.signal);
    options.signal?.throwIfAborted();
    if (!semantic || !validTaskType(semantic.taskType)) return heuristic;
    const complexityRank = { simple: 0, moderate: 1, complex: 2 } as const;
    const reasoningRank = { low: 0, medium: 1, high: 2 } as const;
    const accuracyRank = { standard: 0, high: 1, critical: 2 } as const;
    const semanticComplexity = ['simple', 'moderate', 'complex'].includes(String(semantic.complexity)) ? semantic.complexity! : heuristic.complexity;
    const semanticReasoning = ['low', 'medium', 'high'].includes(String(semantic.reasoningLevel)) ? semantic.reasoningLevel! : heuristic.reasoningLevel;
    const semanticAccuracy = ['standard', 'high', 'critical'].includes(String(semantic.accuracyRequirement)) ? semantic.accuracyRequirement! : heuristic.accuracyRequirement;
    // Semantic refinement may increase safeguards, but must never downgrade heuristic risk.
    const complexity = complexityRank[semanticComplexity] > complexityRank[heuristic.complexity] ? semanticComplexity : heuristic.complexity;
    const reasoningLevel = reasoningRank[semanticReasoning] > reasoningRank[heuristic.reasoningLevel] ? semanticReasoning : heuristic.reasoningLevel;
    const accuracyRequirement = accuracyRank[semanticAccuracy] > accuracyRank[heuristic.accuracyRequirement] ? semanticAccuracy : heuristic.accuracyRequirement;
    const domain = Array.isArray(semantic.domain) ? [...new Set([...heuristic.domain, ...semantic.domain.filter((item): item is string => typeof item === 'string' && item.length <= 80)])].slice(0, 5) : heuristic.domain;
    const taskType = semantic.taskType === 'image' && !heuristic.requiredCapabilities.vision ? heuristic.taskType : semantic.taskType;
    return {
      ...heuristic,
      taskType,
      complexity,
      domain,
      reasoningLevel,
      accuracyRequirement,
      needsTools: heuristic.needsTools || semantic.needsTools === true,
      needsVerification: heuristic.needsVerification || semantic.needsVerification === true || accuracyRequirement !== 'standard',
      confidence: Math.max(heuristic.confidence, 0.75),
      needsSemanticClassification: false,
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return heuristic;
  }
}

function desiredSpeed(task: TaskProfile, effort: Effort): ModelSpec['speed'] {
  if (effort === 'think' || task.complexity === 'complex' || task.reasoningLevel === 'high') return 'deep';
  if (effort === 'fast' || task.complexity === 'simple') return 'fast';
  return 'balanced';
}

function capabilityFor(task: TaskProfile): CapabilityName {
  return task.taskType === 'image' ? 'image' : task.taskType;
}

export function selectModelsHybrid(
  task: TaskProfile,
  effort: Effort,
  catalog: readonly ModelSpec[] = MODEL_CATALOG,
): RegisteredModel[] {
  const registry = getModelRegistry(catalog);
  const enabled = registry.filter(model => model.enabled && model.availability !== 'unavailable');
  if (!enabled.length) throw new AiError('MODEL_UNAVAILABLE', 'Tidak ada model Sumopod yang diaktifkan pada konfigurasi server.', 503);
  const compatible = enabled.filter(model => isModelEligible(model, {
    vision: task.requiredCapabilities.vision,
    contextCharacters: task.contextCharacters,
  }));
  if (!compatible.length) {
    throw new AiError(task.requiredCapabilities.vision ? 'VISION_UNAVAILABLE' : 'CONTEXT_LIMIT',
      task.requiredCapabilities.vision ? 'Tidak ada model gambar yang kompatibel dalam konfigurasi server.' : 'Konteks terlalu panjang untuk model yang dikonfigurasi. Mulai percakapan baru atau ringkas lampiran.', 422);
  }
  const desired = desiredSpeed(task, effort);
  const capability = capabilityFor(task);
  return compatible.sort((a, b) => {
    const score = (model: RegisteredModel) =>
      (model.capabilities.includes(capability) ? 8 : 0)
      + (model.capabilities.includes('general') ? 1 : 0)
      + (model.speed === desired ? 5 : model.speed === 'balanced' && desired !== 'balanced' ? 1 : 0)
      + (task.reasoningLevel === 'high' && model.capabilities.includes('reasoning') ? 4 : 0)
      + (task.requiredCapabilities.vision && model.vision ? 10 : 0);
    return score(b) - score(a);
  });
}

export type HybridRoutingDecision = {
  task: TaskProfile;
  candidates: RegisteredModel[];
  strategy: Strategy;
  selectedModel: RegisteredModel;
  reason: string[];
};

export function buildHybridRoutingDecision(task: TaskProfile, effort: Effort, catalog: readonly ModelSpec[] = MODEL_CATALOG): HybridRoutingDecision {
  const candidates = selectModelsHybrid(task, effort, catalog);
  const selectedModel = candidates[0]!;
  const strategy = strategyFor(task, effort);
  return {
    task,
    candidates,
    strategy,
    selectedModel,
    reason: [
      `task:${task.taskType}`,
      `complexity:${task.complexity}`,
      `effort:${effort}`,
      `capability:${capabilityFor(task)}`,
      `speed:${selectedModel.speed}`,
      `availability:${selectedModel.availability}`,
    ],
  };
}
