export class AiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'AiError';
  }
}
export function safeAiError(error: unknown): { code: string; message: string; status: number } {
  if (error instanceof AiError) return { code: error.code, message: error.message, status: error.status };
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return { code: 'CANCELLED', message: 'Permintaan dibatalkan atau melewati batas waktu.', status: 408 };
  }
  return { code: 'AI_FAILURE', message: 'Permintaan belum dapat diselesaikan. Silakan coba lagi.', status: 502 };
}
