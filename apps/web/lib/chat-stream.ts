export type ChatFrame =
  | { event: "status"; data: { message: string } }
  | { event: "delta"; data: { text: string } }
  | { event: "metadata"; data: Record<string, unknown> }
  | { event: "tool"; data: Record<string, unknown> }
  | { event: "sources"; data: { sources: { title: string; url: string }[] } }
  | { event: "done"; data: { status: "complete"; [key: string]: unknown } }
  | { event: "error"; data: { message: string; code?: string } }
  | { event: "cancelled"; data: Record<string, unknown> };

export class ChatStreamError extends Error {
  constructor(message: string, public readonly code: string) { super(message); this.name = "ChatStreamError"; }
}

function parseFrame(raw: string): ChatFrame | null {
  let event = "message";
  const lines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) lines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!lines.length || !["status", "delta", "metadata", "tool", "sources", "done", "error", "cancelled"].includes(event)) return null;
  let data: unknown;
  try { data = JSON.parse(lines.join("\n")); } catch { throw new ChatStreamError("Format respons server tidak valid.", "INVALID_STREAM"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ChatStreamError("Format respons server tidak valid.", "INVALID_STREAM");
  const object = data as Record<string, unknown>;
  if (event === "delta" && typeof object.text !== "string" || event === "status" && typeof object.message !== "string" || event === "error" && typeof object.message !== "string" || event === "done" && object.status !== "complete") throw new ChatStreamError("Format respons server tidak valid.", "INVALID_STREAM");
  if (event === "sources") {
    if (!Array.isArray(object.sources) || !object.sources.every(item => item && typeof item === "object" && typeof item.title === "string" && typeof item.url === "string")) throw new ChatStreamError("Sumber respons server tidak valid.", "INVALID_STREAM");
  }
  return { event, data: object } as ChatFrame;
}

/** A transport ending without `done` is incomplete, even if it yielded readable text. */
export async function readChatStream(body: ReadableStream<Uint8Array>, onFrame: (frame: ChatFrame) => void, signal?: AbortSignal): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", completed = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (!completed) {
      if (signal?.aborted) throw new DOMException("Permintaan dibatalkan.", "AbortError");
      const result = await reader.read();
      if (signal?.aborted) throw new DOMException("Permintaan dibatalkan.", "AbortError");
      buffer += result.done ? decoder.decode() : decoder.decode(result.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 512_000) throw new ChatStreamError("Respons server melebihi batas.", "STREAM_LIMIT");
      let separator: number;
      while ((separator = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, separator); buffer = buffer.slice(separator + 2);
        const frame = parseFrame(raw);
        if (!frame) continue;
        onFrame(frame);
        if (frame.event === "error") throw new ChatStreamError(frame.data.message, frame.data.code || "PROVIDER_ERROR");
        if (frame.event === "cancelled") throw new DOMException("Permintaan dibatalkan.", "AbortError");
        if (frame.event === "done") { completed = true; break; }
      }
      if (result.done) break;
    }
    if (!completed) throw new ChatStreamError("Respons terputus. Jawaban belum selesai; coba ulang.", "STREAM_INCOMPLETE");
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
