import type { Effort } from '@aet/contracts';
import type { AiProvider, ProviderMessage } from '../provider.js';
import { AiError } from '../errors.js';
import type { RegisteredModel } from '../models/registry.js';
import { selectModelsHybrid, type TaskProfile } from '../routing/hybrid-router.js';
import { buildPlannerMessages, parsePlan, type PlannedSubtask } from '../agents/planner.js';
import { buildGeneratorMessages } from '../agents/generator.js';
import { buildReviewMessages, parseReview } from '../agents/reviewer.js';
import { buildRevisionMessages } from '../agents/reviser.js';
import { buildEvaluationMessages, parseQualityEvaluation } from '../evaluation/evaluator.js';
import { evaluateQualityGate } from '../evaluation/quality-gate.js';
import type { EvidenceMaterial, QualityGateDecision } from '../evaluation/types.js';

export type AdaptivePipelineEvent =
  | { type: 'stage'; stage: 'planning' | 'generation' | 'review' | 'evaluation' | 'revision'; message: string }
  | { type: 'result'; answer: string; callsUsed: number; finalModel: string; modelsUsed: string[]; subtasks: number; reviewed: boolean; revised: boolean; qualityGate?: QualityGateDecision; evaluationAvailable?: boolean; postRevisionRechecked?: boolean };

export type AdaptivePipelineOptions = {
  provider: AiProvider;
  messages: ProviderMessage[];
  task: TaskProfile;
  effort: Effort;
  candidates: readonly RegisteredModel[];
  signal: AbortSignal;
  maxModelCalls: number;
  maxOutputTokens: number;
  qualityEvaluation?: boolean;
  evidence?: EvidenceMaterial[];
};

function modelForTask(
  task: TaskProfile,
  effort: Effort,
  candidates: readonly RegisteredModel[],
): RegisteredModel {
  const ranked = selectModelsHybrid(task, effort, candidates);
  return ranked[0]!;
}

function safeSubtasks(raw: string, task: TaskProfile): PlannedSubtask[] {
  const parsed = parsePlan(raw, task.taskType);
  if (parsed?.length) return parsed;
  return [{
    id: 'subtask-1',
    title: 'Menyelesaikan permintaan pengguna',
    instruction: 'Jawab permintaan pengguna secara utuh. Pertahankan semua instruksi, batasan, dan format yang diminta.',
    taskType: task.taskType,
  }];
}

/**
 * Bounded sequential multi-model pipeline:
 * planner -> up to two specialized generators -> reviewer -> optional one revision.
 * All model output is treated as untrusted data and all calls share one hard budget.
 */
export async function* runAdaptivePipeline(
  options: AdaptivePipelineOptions,
): AsyncGenerator<AdaptivePipelineEvent> {
  const { provider, messages, task, effort, candidates, signal } = options;
  let callsUsed = 0;
  const modelsUsed: string[] = [];

  const call = async (
    preferredModel: RegisteredModel,
    prompt: ProviderMessage[],
    maxTokens = options.maxOutputTokens,
  ): Promise<{ text: string; modelId: string }> => {
    const attempts = [
      preferredModel,
      ...candidates.filter(candidate => candidate.id !== preferredModel.id),
    ].slice(0, 2);
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts.length; attempt++) {
      const model = attempts[attempt]!;
      signal.throwIfAborted();
      if (callsUsed >= options.maxModelCalls) {
        throw new AiError('STEP_LIMIT', 'Batas pemanggilan model untuk adaptive orchestration tercapai.', 422);
      }
      callsUsed++;
      modelsUsed.push(model.id);

      try {
        const output = await provider.complete({
          model,
          messages: prompt,
          signal,
          maxTokens,
          effort,
        });
        if (!output.trim() || output.length > 100_000) {
          throw new AiError('PROVIDER_EMPTY', 'Adaptive orchestration menerima respons kosong atau terlalu besar.', 502);
        }
        return { text: output, modelId: model.id };
      } catch (error) {
        lastError = error;
        const canRetry =
          (error instanceof AiError && ['PROVIDER_REJECTED', 'PROVIDER_RATE_LIMIT', 'PROVIDER_EMPTY'].includes(error.code))
          || error instanceof TypeError;
        if (!canRetry || signal.aborted || attempt === attempts.length - 1) throw error;
      }
    }

    throw lastError ?? new AiError('PROVIDER_ERROR', 'Model tidak dapat menyelesaikan tahap orchestration.', 502);
  };

  if (options.maxModelCalls < 3 || candidates.length === 0) {
    throw new AiError('ORCHESTRATION_BUDGET', 'Adaptive orchestration membutuhkan minimal tiga pemanggilan model dan satu kandidat.', 422);
  }

  yield {
    type: 'stage',
    stage: 'planning',
    message: 'Menyusun rencana kerja adaptif',
  };

  const plannerModel = modelForTask(
    { ...task, taskType: 'general', reasoningLevel: 'high' },
    effort,
    candidates,
  );
  const planCall = await call(
    plannerModel,
    buildPlannerMessages(messages, task),
    500,
  );
  const subtasks = safeSubtasks(planCall.text, task);

  // Reserve calls for evaluation and a possible revision when quality
  // evaluation is enabled. The planner and final evaluator each consume one.
  const generationCapacity = options.qualityEvaluation
    ? Math.max(1, Math.min(2, options.maxModelCalls - 3))
    : 2;
  const boundedSubtasks = subtasks.slice(0, generationCapacity);
  const generated: Array<{ subtask: PlannedSubtask; answer: string; model: string }> = [];

  for (let index = 0; index < boundedSubtasks.length; index++) {
    signal.throwIfAborted();
    const subtask = boundedSubtasks[index]!;
    const subtaskProfile: TaskProfile = {
      ...task,
      taskType: subtask.taskType,
      needsSemanticClassification: false,
    };
    const generatorModel = modelForTask(subtaskProfile, effort, candidates);

    yield {
      type: 'stage',
      stage: 'generation',
      message: `Mengerjakan bagian ${index + 1} dari ${boundedSubtasks.length}: ${subtask.title}`,
    };

    const generatedCall = await call(
      generatorModel,
      buildGeneratorMessages(messages, subtask, index, boundedSubtasks.length),
    );
    generated.push({ subtask, answer: generatedCall.text, model: generatedCall.modelId });
  }

  // Do not inject headings or a new format: the user's explicit output
  // constraints remain authoritative. The reviewer checks the joined draft.
  const draft = generated.map(item => item.answer).join('\n\n');

  // Prefer an independent reviewer/evaluator model, but safely fall back
  // when only one candidate is eligible.
  const reviewerCandidates = selectModelsHybrid(
    { ...task, taskType: 'general' },
    effort,
    candidates,
  );
  const lastGeneratorModel = generated.at(-1)!.model;
  const reviewerModel = reviewerCandidates.find(model => model.id !== lastGeneratorModel)
    ?? reviewerCandidates[0]!;

  let answer = draft;
  let revised = false;
  let reviewed = false;
  let qualityGate: QualityGateDecision | undefined;
  let evaluationAvailable = false;
  let postRevisionRechecked = false;

  if (options.qualityEvaluation) {
    yield {
      type: 'stage',
      stage: 'evaluation',
      message: 'Menilai kualitas jawaban berdasarkan rubrik domain dan bukti',
    };

    const evaluationCall = await call(
      reviewerModel,
      buildEvaluationMessages(messages, draft, task, options.evidence ?? [], { maxContextCharacters: reviewerModel.maxContextCharacters }),
      1_100,
    );
    const evaluation = parseQualityEvaluation(
      evaluationCall.text,
      options.evidence ?? [],
    );
    evaluationAvailable = evaluation !== null;
    reviewed = evaluation !== null;
    qualityGate = evaluateQualityGate(evaluation, task, (options.evidence ?? []).some(item => item.available && item.text.trim().length > 0));

    if (
      qualityGate.status === 'revision_required' &&
      callsUsed < options.maxModelCalls
    ) {
      yield {
        type: 'stage',
        stage: 'revision',
        message: 'Memperbaiki jawaban berdasarkan hasil quality evaluation',
      };

      const issues = evaluation?.issues.map(issue =>
        `[${issue.dimension}/${issue.severity}] ${issue.description}`,
      ) ?? qualityGate.reasons;
      const reviserModel = modelForTask(task, effort, candidates);
      const revisionCall = await call(
        reviserModel,
        buildRevisionMessages(messages, draft, issues),
      );
      answer = revisionCall.text;
      revised = true;

      // Re-evaluate only if the existing execution budget still permits it.
      // Otherwise expose the pending recheck honestly in the final metadata.
      if (callsUsed < options.maxModelCalls) {
        yield {
          type: 'stage',
          stage: 'evaluation',
          message: 'Memeriksa kembali hasil revisi',
        };
        const recheckCall = await call(
          reviewerModel,
          buildEvaluationMessages(messages, answer, task, options.evidence ?? [], { maxContextCharacters: reviewerModel.maxContextCharacters }),
          1_100,
        );
        const recheck = parseQualityEvaluation(
          recheckCall.text,
          options.evidence ?? [],
        );
        postRevisionRechecked = recheck !== null;
        evaluationAvailable = recheck !== null;
        if (recheck) {
          qualityGate = evaluateQualityGate(
            recheck,
            task,
            (options.evidence ?? []).some(item => item.available && item.text.trim().length > 0),
          );
        } else if (qualityGate) {
          qualityGate = {
            ...qualityGate,
            status: 'review_unavailable',
            reasons: [
              ...qualityGate.reasons,
              'Evaluasi ulang setelah revisi tidak menghasilkan laporan valid; hasil revisi belum dapat dinyatakan lulus.',
            ],
          };
        }
      }
    }
  } else {
    // Phase 3 compatibility path: preserve its original reviewer behavior.
    yield {
      type: 'stage',
      stage: 'review',
      message: 'Memeriksa kelengkapan dan konsistensi hasil',
    };

    const reviewCall = await call(
      reviewerModel,
      buildReviewMessages(messages, draft),
      650,
    );
    const review = parseReview(reviewCall.text);
    reviewed = review !== null;

    if (
      review?.revise &&
      review.issues.length > 0 &&
      callsUsed < options.maxModelCalls
    ) {
      yield {
        type: 'stage',
        stage: 'revision',
        message: 'Memperbaiki hasil berdasarkan evaluasi',
      };

      const reviserModel = modelForTask(task, effort, candidates);
      const revisionCall = await call(
        reviserModel,
        buildRevisionMessages(messages, draft, review.issues),
      );
      answer = revisionCall.text;
      revised = true;
    }
  }

  // A high-severity accuracy/instruction/evidence blocker is fail-closed.
  // A non-blocking revision without spare budget is returned as explicitly
  // pending recheck, never mislabeled as quality-gate passed.
  if (qualityGate?.blockingIssues.length) {
    throw new AiError(
      'QUALITY_GATE_BLOCKED',
      'Jawaban belum dapat diberikan karena masih terdapat masalah berkeparahan tinggi pada akurasi, kepatuhan instruksi, atau dukungan bukti. Coba ulangi dengan konteks atau sumber yang lebih lengkap.',
      422,
    );
  }

  signal.throwIfAborted();

  yield {
    type: 'result',
    answer,
    callsUsed,
    finalModel: revised ? modelsUsed.at(-1)! : generated.at(-1)!.model,
    modelsUsed: [...new Set(modelsUsed)],
    subtasks: boundedSubtasks.length,
    reviewed,
    revised,
    ...(qualityGate ? { qualityGate, evaluationAvailable, postRevisionRechecked } : {}),
  };
}
