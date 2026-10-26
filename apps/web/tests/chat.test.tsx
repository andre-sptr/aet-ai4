import test, { after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { conversationKey } from "../lib/conversations";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000/" });
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "localStorage"] as const) Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
const { createElement } = await import("react");
mock.module("next/image", { defaultExport: function MockImage({ unoptimized: _unoptimized, ...props }: Record<string, unknown>) { return createElement("img", props); } });
mock.module("next/link", { defaultExport: function MockLink(props: Record<string, unknown>) { return createElement("a", props); } });
const { render, fireEvent, waitFor, cleanup } = await import("@testing-library/react");
const { default: ChatWorkspace } = await import("../components/chat/ChatWorkspace");
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; dom.window.localStorage.clear(); });
after(() => dom.window.close());
const encoder = new TextEncoder();
const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

test("chat sends persona and effort, streams a completed answer, and never submits a browser-selected model", async () => {
  let request: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(String(options?.body));
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(frame("status", { message: "Menyiapkan jawaban" }));
      controller.enqueue(frame("delta", { text: "Jawaban yang selesai" }));
      controller.enqueue(frame("done", { status: "complete", requestId: "test-completed" }));
      controller.close();
    } }), { headers: { "Content-Type": "text/event-stream" } });
  };
  const view = render(<ChatWorkspace initialPersona="coding" onBack={() => {}} />);
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Kirim pesan" }).hasAttribute("disabled"), true));
  fireEvent.click(view.getByRole("radio", { name: "Fast" }));
  fireEvent.change(view.getByRole("textbox", { name: "Pesan untuk Coding Expert" }), { target: { value: "Jelaskan loop ini" } });
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Kirim pesan" }).hasAttribute("disabled"), false));
  fireEvent.click(view.getByRole("button", { name: "Kirim pesan" }));
  assert.ok(await view.findByText("Jawaban yang selesai"));
  await waitFor(() => assert.ok(view.getByRole("button", { name: "Kirim pesan" })));
  assert.equal(request?.persona, "coding"); assert.equal(request?.effort, "fast");
  assert.equal("model" in request!, false);
  assert.deepEqual(request?.messages, [{ role: "user", content: "Jelaskan loop ini" }]);
  const persisted = JSON.parse(dom.window.localStorage.getItem(conversationKey("coding"))!);
  assert.equal(persisted.conversations[0].messages.at(-1).state, "complete");
});

test("cancel marks partial output incomplete and retry excludes it from provider context", async () => {
  let attempt = 0;
  const payloads: Record<string, unknown>[] = [];
  let cancelled = false;
  globalThis.fetch = async (_url, options) => {
    payloads.push(JSON.parse(String(options?.body))); attempt += 1;
    if (attempt === 1) return new Response(new ReadableStream({ start(controller) { controller.enqueue(frame("delta", { text: "Jawaban parsial" })); }, cancel() { cancelled = true; } }));
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(frame("delta", { text: "Jawaban ulang lengkap" })); controller.enqueue(frame("done", { status: "complete", requestId: "retry" })); controller.close(); } }));
  };
  const view = render(<ChatWorkspace initialPersona="daily" onBack={() => {}} />);
  fireEvent.change(view.getByRole("textbox", { name: "Pesan untuk Smart Companion" }), { target: { value: "Bantu rencanakan belajar" } });
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Kirim pesan" }).hasAttribute("disabled"), false));
  fireEvent.click(view.getByRole("button", { name: "Kirim pesan" }));
  assert.ok(await view.findByText("Jawaban parsial"));
  fireEvent.click(view.getByRole("button", { name: "Hentikan jawaban" }));
  assert.ok(await view.findByRole("alert"));
  assert.equal(cancelled, true);
  assert.match(view.getByText(/Teks ini tidak digunakan/).textContent || "", /belum selesai/);
  fireEvent.click(view.getByRole("button", { name: "Coba ulang" }));
  assert.ok(await view.findByText("Jawaban ulang lengkap"));
  assert.deepEqual(payloads[1].messages, [{ role: "user", content: "Bantu rencanakan belajar" }]);
});

test("history rename and confirmed deletion update the browser store without affecting another conversation", async () => {
  const view = render(<ChatWorkspace initialPersona="report" onBack={() => {}} />);
  const newButtons = view.getAllByRole("button", { name: "Percakapan baru" });
  await waitFor(() => assert.equal(newButtons[0].hasAttribute("disabled"), false));
  fireEvent.click(view.getByRole("button", { name: "Ganti nama percakapan" }));
  fireEvent.change(view.getByLabelText("Nama percakapan"), { target: { value: "Kerangka praktikum" } });
  fireEvent.click(view.getByRole("button", { name: "Simpan nama" }));
  assert.ok(view.getByRole("button", { name: "Kerangka praktikum" }));
  fireEvent.click(view.getAllByRole("button", { name: "Percakapan baru" })[0]);
  fireEvent.click(view.getByRole("button", { name: "Hapus percakapan" }));
  assert.ok(view.getByRole("dialog", { name: "Hapus percakapan ini?" }));
  fireEvent.click(view.getByRole("button", { name: "Batal" }));
  assert.equal(view.queryByRole("dialog"), null);
  fireEvent.click(view.getByRole("button", { name: "Hapus percakapan" }));
  const dialog = view.getByRole("dialog", { name: "Hapus percakapan ini?" });
  fireEvent.click(Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "Hapus percakapan")!);
  const saved = JSON.parse(dom.window.localStorage.getItem(conversationKey("report"))!);
  assert.equal(saved.conversations.length, 1);
  assert.equal(saved.conversations[0].title, "Kerangka praktikum");
});

test("editing an earlier user message regenerates from that point and drops later answers", async () => {
  let call = 0;
  const requests: { messages: { role: string; content: string }[] }[] = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body))); call += 1;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(frame("delta", { text: `Jawaban ${call}` })); controller.enqueue(frame("done", { status: "complete", requestId: String(call) })); controller.close(); } }));
  };
  const view = render(<ChatWorkspace initialPersona="coding" onBack={() => {}} />);
  const input = view.getByRole("textbox", { name: "Pesan untuk Coding Expert" });
  fireEvent.change(input, { target: { value: "Kode pertama" } });
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Kirim pesan" }).hasAttribute("disabled"), false));
  fireEvent.click(view.getByRole("button", { name: "Kirim pesan" }));
  assert.ok(await view.findByText("Jawaban 1"));
  await waitFor(() => assert.ok(view.getByRole("button", { name: "Edit" })));
  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  fireEvent.change(input, { target: { value: "Kode diperbaiki" } });
  fireEvent.click(view.getByRole("button", { name: "Kirim pesan" }));
  assert.ok(await view.findByText("Jawaban 2"));
  assert.equal(view.queryByText("Jawaban 1"), null);
  assert.deepEqual(requests[1].messages, [{ role: "user", content: "Kode diperbaiki" }]);
});
