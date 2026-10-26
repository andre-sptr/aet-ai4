import test from "node:test";
import assert from "node:assert/strict";
import { conversationKey, deleteConversation, emptyStore, loadStore, modelMessages, newConversation, persistStore, retryMessages, updateConversation, type LocalMessage } from "../lib/conversations";

function memory() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const user = (id: string, content: string): LocalMessage => ({ id, role: "user", content, state: "complete" });

test("saved browser history excludes image bytes, bounds text and marks streaming output incomplete", () => {
  const storage = memory(), store = emptyStore("daily");
  store.conversations[0].messages = [
    { ...user("1", "Lihat gambar ini"), attachments: [{ id: "image", name: "gambar.png", mimeType: "image/png", size: 3, dataUrl: "data:image/png;base64,AAAA" }, { id: "document", name: "teks.txt", mimeType: "text/plain", size: 20_000, text: "a".repeat(20_000) }] },
    { id: "2", role: "assistant", content: "Sedang menjawab", state: "streaming" },
  ];
  persistStore(storage, "daily", store);
  const raw = storage.getItem(conversationKey("daily"))!;
  assert.equal(raw.includes("base64"), false);
  const restored = loadStore(storage, "daily");
  assert.equal(restored.conversations[0].messages[1].state, "incomplete");
  assert.equal(restored.conversations[0].messages[0].attachments?.[1].text?.length, 12_000);
});

test("mode histories stay separate and corrupted records are never overwritten by loading", () => {
  const storage = memory();
  const daily = emptyStore("daily"), coding = emptyStore("coding");
  daily.conversations[0].title = "Diskusi"; coding.conversations[0].title = "Debug";
  persistStore(storage, "daily", daily); persistStore(storage, "coding", coding);
  assert.equal(loadStore(storage, "daily").conversations[0].title, "Diskusi");
  assert.equal(loadStore(storage, "coding").conversations[0].title, "Debug");
  storage.setItem(conversationKey("report"), "{broken");
  assert.throws(() => loadStore(storage, "report"), /tidak dapat dibaca/);
  assert.equal(storage.getItem(conversationKey("report")), "{broken");
});

test("rename, switch and deletion preserve other conversations, including when the active item is deleted", () => {
  const first = emptyStore("daily");
  const item = newConversation("daily"); item.title = "Judul baru";
  const updated = updateConversation(first, item);
  assert.equal(updated.activeId, item.id);
  assert.equal(updated.conversations.length, 2);
  const after = deleteConversation(updated, item.id, "daily");
  assert.equal(after.activeId, first.activeId);
  assert.equal(after.conversations.length, 1);
  const empty = deleteConversation(after, after.activeId, "daily");
  assert.equal(empty.conversations.length, 1);
  assert.deepEqual(empty.conversations[0].messages, []);
});

test("retry removes the failed response and new model context excludes incomplete assistant output", () => {
  const messages: LocalMessage[] = [user("1", "Pertama"), { id: "2", role: "assistant", content: "Lengkap", state: "complete" }, user("3", "Lanjutan"), { id: "4", role: "assistant", content: "Parsial", state: "incomplete" }];
  assert.equal(retryMessages(messages).length, 3);
  assert.deepEqual(modelMessages(messages).map(item => item.content), ["Pertama", "Lengkap", "Lanjutan"]);
});
