export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code = "REQUEST_FAILED") {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (typeof options.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: "include" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError("API tidak dapat dihubungi. Periksa koneksi lalu coba kembali.", 0, "NETWORK_ERROR");
  }
  const data: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const detail = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : payload;
    const message = typeof detail.message === "string" ? detail.message : typeof payload.error === "string" ? payload.error : "Permintaan tidak berhasil. Coba kembali.";
    throw new ApiError(message, response.status, typeof detail.code === "string" ? detail.code : "REQUEST_FAILED");
  }
  return data as T;
}
