import { AiError } from '../errors.js';
import { readBoundedBody } from '../limits.js';

export const SUMOPOD_MODELS_ENDPOINT = 'https://ai.sumopod.com/v1/models';

export type SumopodModelList = {
  ids: string[];
  object?: string;
};

/**
 * Reads the authenticated OpenAI-compatible /models endpoint.
 * The endpoint returns model identifiers only; this function deliberately does
 * not infer capabilities, context windows, pricing, or availability for chat.
 */
export async function fetchSumopodModelIds(options: {
  apiKey?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
} = {}): Promise<SumopodModelList> {
  const apiKey = options.apiKey ?? process.env.SUMOPOD_API_KEY;
  if (!apiKey) throw new AiError('PROVIDER_UNCONFIGURED', 'SUMOPOD_API_KEY belum dikonfigurasi.', 503);
  const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(15_000)]);
  const response = await (options.fetcher ?? fetch)(SUMOPOD_MODELS_ENDPOINT, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal,
    redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AiError(response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH' : 'MODEL_DISCOVERY_FAILED',
      response.status === 401 || response.status === 403 ? 'Sumopod menolak autentikasi untuk daftar model.' : 'Daftar model Sumopod tidak dapat diambil.',
      response.status === 429 ? 429 : 502);
  }
  const raw = await readBoundedBody(response, 256_000, signal);
  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { throw new AiError('MODEL_DISCOVERY_FORMAT', 'Format daftar model Sumopod bukan JSON yang valid.', 502); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AiError('MODEL_DISCOVERY_FORMAT', 'Struktur daftar model Sumopod tidak valid.', 502);
  }
  const record = payload as { object?: unknown; data?: unknown };
  if (!Array.isArray(record.data) || record.data.length > 1_000) {
    throw new AiError('MODEL_DISCOVERY_FORMAT', 'Daftar model Sumopod tidak memiliki array data yang valid.', 502);
  }
  const ids = [...new Set(record.data.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const id = (item as { id?: unknown }).id;
    return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(id) ? [id] : [];
  }))].sort((a, b) => a.localeCompare(b));
  if (!ids.length) throw new AiError('MODEL_DISCOVERY_EMPTY', 'Sumopod tidak mengembalikan model ID yang dapat digunakan.', 502);
  return { ids, ...(typeof record.object === 'string' ? { object: record.object } : {}) };
}
