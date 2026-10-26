import type { ChatRequest, Effort } from '@aet/contracts';
import { MODEL_CATALOG, type ModelSpec } from './models.js';
import { planTools, type ToolCall } from './tools.js';
import { AiError } from './errors.js';

export type TaskType = 'general' | 'writing' | 'research' | 'coding' | 'math' | 'document' | 'image';
export type Classification = {
  taskType: TaskType;
  complexity: 'simple' | 'moderate' | 'complex';
  needsTools: boolean;
  needsVerification: boolean;
  requiredCapabilities: { vision: boolean };
  contextCharacters: number;
  tools: ToolCall[];
};
export type Strategy = { name: 'direct' | 'tool-assisted' | 'deliberate' | 'plan-and-review'; plan: boolean; verify: boolean; maxSteps: number; maxModelCalls: number; maxTools: number; maxOutputTokens: number; deadlineMs: number };

export function classify(request: ChatRequest): Classification {
  const last = request.messages.at(-1)!;
  const recent = request.messages.filter(message => message.role === 'user').slice(-3).map(message => message.content).join('\n');
  const images = request.messages.some(message => message.attachments?.some(attachment => attachment.dataUrl));
  const document = request.messages.some(message => message.attachments?.some(attachment => attachment.text));
  const contextCharacters = request.messages.reduce((total, message) => total + message.content.length + (message.attachments ?? []).reduce((n, attachment) => n + (attachment.text?.length ?? 0), 0), 0);
  const tools = planTools(last.content);
  if (!tools.length && /\b(?:terbaru|terkini|current|latest|hari ini|today)\b/i.test(last.content) && /\b(?:berita|news|cari|search|sumber|sources?|informasi)\b/i.test(last.content) && !/\b(?:jangan|tanpa|don't|do not)\b/i.test(last.content)) tools.push({ name: 'search', args: { query: last.content.slice(0, 400) } });
  const code = /```|\b(?:debug|bug|typescript|javascript|python|sql|kode|code|program|function|algoritma|algorithm)\b/i.test(recent);
  const math = /\b(?:hitung|calculate|persamaan|equation|statistik|statistics|integral|matriks|matrix)\b/i.test(recent);
  const research = /\b(?:penelitian|research|referensi|citation|sitasi|jurnal|literature|sumber|sources)\b/i.test(recent);
  const writing = /\b(?:tulis|write|essay|esai|makalah|skripsi|surat|draft|paragraf)\b/i.test(recent);
  const taskType: TaskType = images ? 'image' : code || request.persona === 'coding' ? 'coding' : math ? 'math' : research || request.persona === 'report' ? 'research' : document ? 'document' : writing ? 'writing' : 'general';
  const indicators = [last.content.length > 1200, /\b(?:bandingkan|compare|analisis|analyze|rancang|design|buktikan|prove|arsitektur|architecture)\b/i.test(last.content), (last.content.match(/\n[-\d*]|\?/g) ?? []).length > 3, document, images && code, /\b(?:produksi|production|keamanan|security|diagnos|medis|legal|keuangan|financial)\b/i.test(last.content)].filter(Boolean).length;
  const complexity = indicators >= 2 ? 'complex' : indicators || last.content.length > 350 ? 'moderate' : 'simple';
  return { taskType, complexity, needsTools: tools.length > 0, needsVerification: complexity === 'complex' || math && complexity !== 'simple', requiredCapabilities: { vision: images }, contextCharacters, tools: tools.slice(0, 3) };
}
export function strategyFor(task: Classification, effort: Effort): Strategy {
  const plan = effort === 'think' && task.complexity === 'complex';
  const verify = effort !== 'fast' && task.needsVerification;
  return {
    name: plan ? 'plan-and-review' : verify ? 'deliberate' : task.needsTools ? 'tool-assisted' : 'direct',
    plan, verify,
    maxSteps: effort === 'think' ? 10 : effort === 'normal' ? 9 : 5,
    maxModelCalls: effort === 'think' ? 5 : effort === 'normal' ? 4 : 3,
    maxTools: effort === 'fast' ? 1 : 3,
    maxOutputTokens: effort === 'fast' ? 1500 : effort === 'normal' ? 3500 : 6000,
    deadlineMs: effort === 'think' ? 90_000 : effort === 'normal' ? 60_000 : 35_000,
  };
}
export function selectModels(task: Classification, effort: Effort, catalog: readonly ModelSpec[] = MODEL_CATALOG): ModelSpec[] {
  const compatible = catalog.filter(model => (!task.requiredCapabilities.vision || model.vision) && task.contextCharacters <= model.maxContextCharacters);
  if (!compatible.length) throw new AiError(task.requiredCapabilities.vision ? 'VISION_UNAVAILABLE' : 'CONTEXT_LIMIT', task.requiredCapabilities.vision ? 'Tidak ada model gambar yang kompatibel dalam konfigurasi server.' : 'Konteks terlalu panjang untuk model yang dikonfigurasi. Mulai percakapan baru atau ringkas lampiran.', 422);
  const desired = effort === 'think' || task.complexity === 'complex' ? 'deep' : effort === 'fast' ? 'fast' : task.taskType === 'general' && task.complexity === 'simple' ? 'fast' : 'balanced';
  return [...compatible].sort((a, b) => {
    const score = (model: ModelSpec) => (model.speed === desired ? 5 : 0) + (model.strengths.includes(task.taskType) ? 4 : 0) + (model.vision && task.requiredCapabilities.vision ? 10 : 0);
    return score(b) - score(a);
  });
}
