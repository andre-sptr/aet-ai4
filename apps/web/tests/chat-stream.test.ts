import test from "node:test";
import assert from "node:assert/strict";
import { readChatStream, type ChatFrame } from "../lib/chat-stream";

const encoder = new TextEncoder();
function bytes(parts: string[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close(); } });
}

test("SSE parser assembles split CRLF frames and only accepts an explicit completion", async () => {
  const frames: ChatFrame[] = [];
  await readChatStream(bytes([': keep-alive\r\n\r\nevent: status\r\ndata: {"message":"Menganalisis"}\r', '\n\r\nevent: delta\r\ndata: {"text":"Halo 👋"}\r\n\r\nevent: done\r\ndata: {"status":"complete","requestId":"test"}\r\n\r\n']), frame => frames.push(frame));
  assert.deepEqual(frames.map(frame => frame.event), ["status", "delta", "done"]);
  assert.deepEqual(frames[1].data, { text: "Halo 👋" });
});

test("partial answer is an error when the network stream ends before done", async () => {
  await assert.rejects(readChatStream(bytes(['event: delta\ndata: {"text":"Separuh jawaban"}\n\n']), () => {}), { code: "STREAM_INCOMPLETE" });
});

test("provider error and invalid event payload cannot become completed answers", async () => {
  await assert.rejects(readChatStream(bytes(['event: error\ndata: {"code":"UPSTREAM_TIMEOUT","message":"Waktu habis"}\n\n']), () => {}), { code: "UPSTREAM_TIMEOUT", message: "Waktu habis" });
  await assert.rejects(readChatStream(bytes(['event: delta\ndata: {"text":17}\n\n']), () => {}), { code: "INVALID_STREAM" });
});

test("cancellation interrupts a pending reader and never yields done", async () => {
  let wasCancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { wasCancelled = true; } });
  const controller = new AbortController();
  const pending = readChatStream(body, () => assert.fail("No events expected"), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(wasCancelled, true);
});

test("oversized buffered SSE data fails closed", async () => {
  await assert.rejects(readChatStream(bytes(["x".repeat(512_001)]), () => {}), { code: "STREAM_LIMIT" });
});
