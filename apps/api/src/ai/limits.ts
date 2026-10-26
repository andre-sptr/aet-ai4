import { AiError } from './errors.js';

export async function readBoundedBody(response: Response, maximumBytes: number, signal?: AbortSignal): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > maximumBytes) {
    await response.body?.cancel();
    throw new AiError('RESPONSE_SIZE', 'Respons layanan melebihi batas ukuran.', 502);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  const abort = () => { void reader.cancel(signal?.reason); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) { text += decoder.decode(); break; }
      size += part.value.byteLength;
      if (size > maximumBytes) throw new AiError('RESPONSE_SIZE', 'Respons layanan melebihi batas ukuran.', 502);
      text += decoder.decode(part.value, { stream: true });
    }
    return text;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
