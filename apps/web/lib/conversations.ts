import type { Persona, Attachment, Source } from "@aet/contracts";
export type { Persona, Effort, Attachment, Source } from "@aet/contracts";
export interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  state: "complete" | "incomplete" | "streaming";
  attachments?: Attachment[];
  sources?: Source[];
}
export interface Conversation { id: string; persona: Persona; title: string; updatedAt: string; messages: LocalMessage[] }
export interface ConversationStore { version: 1; activeId: string; conversations: Conversation[] }
type StorageLike = Pick<Storage, "getItem" | "setItem">;
export const conversationKey = (persona: Persona) => `aet-rebuilt-history:${persona}:v1`;
export const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export function newConversation(persona: Persona): Conversation {
  return { id: newId(), persona, title: "Percakapan baru", updatedAt: new Date().toISOString(), messages: [] };
}
export function emptyStore(persona: Persona): ConversationStore {
  const item = newConversation(persona);
  return { version: 1, activeId: item.id, conversations: [item] };
}

function boundedAttachment(item: Attachment): Attachment {
  return { id: item.id.slice(0, 100), name: item.name.slice(0, 200), mimeType: item.mimeType, size: item.size, ...(item.text ? { text: item.text.slice(0, 12_000) } : {}) };
}
export function persistedConversation(item: Conversation): Conversation {
  return { ...item, title: item.title.slice(0, 100), messages: item.messages.slice(-60).map(message => ({
    id: message.id, role: message.role, content: message.content.slice(0, 24_000), state: message.state === "streaming" ? "incomplete" : message.state,
    ...(message.attachments?.length ? { attachments: message.attachments.slice(0, 4).map(boundedAttachment) } : {}),
    ...(message.sources?.length ? { sources: message.sources.slice(0, 12).map(source => ({ title: source.title.slice(0, 300), url: source.url.slice(0, 2000) })) } : {}),
  })) };
}
export function persistStore(storage: StorageLike, persona: Persona, store: ConversationStore): void {
  storage.setItem(conversationKey(persona), JSON.stringify({ ...store, conversations: store.conversations.slice(0, 40).map(persistedConversation) }));
}
export function loadStore(storage: StorageLike, persona: Persona): ConversationStore {
  const raw = storage.getItem(conversationKey(persona));
  if (!raw) return emptyStore(persona);
  let candidate: unknown;
  try { candidate = JSON.parse(raw); } catch { throw new Error("Riwayat browser tidak dapat dibaca. Data lama tidak ditimpa."); }
  if (!candidate || typeof candidate !== "object") throw new Error("Format riwayat tidak dikenali. Data lama tidak ditimpa.");
  const data = candidate as Partial<ConversationStore>;
  if (data.version !== 1 || !Array.isArray(data.conversations) || data.conversations.length > 40 || typeof data.activeId !== "string") throw new Error("Format riwayat tidak dikenali. Data lama tidak ditimpa.");
  const valid = data.conversations.every(item => item && typeof item.id === "string" && item.persona === persona && typeof item.title === "string" && typeof item.updatedAt === "string" && Array.isArray(item.messages) && item.messages.length <= 60 && item.messages.every(message => message && typeof message.id === "string" && ["user", "assistant"].includes(message.role) && typeof message.content === "string" && ["complete", "incomplete", "streaming"].includes(message.state) && (!message.attachments || Array.isArray(message.attachments) && message.attachments.every(attachment => attachment && typeof attachment.id === "string" && typeof attachment.name === "string" && typeof attachment.mimeType === "string" && typeof attachment.size === "number" && (attachment.text === undefined || typeof attachment.text === "string")))));
  if (!valid) throw new Error("Format riwayat tidak dikenali. Data lama tidak ditimpa.");
  const items = data.conversations.map(persistedConversation);
  if (!items.length) return emptyStore(persona);
  return { version: 1, activeId: items.some(item => item.id === data.activeId) ? data.activeId : items[0].id, conversations: items };
}
export function updateConversation(store: ConversationStore, conversation: Conversation): ConversationStore {
  return { ...store, activeId: conversation.id, conversations: [conversation, ...store.conversations.filter(item => item.id !== conversation.id)].slice(0, 40) };
}
export function deleteConversation(store: ConversationStore, id: string, persona: Persona): ConversationStore {
  const items = store.conversations.filter(item => item.id !== id);
  if (!items.length) return emptyStore(persona);
  return { ...store, activeId: store.activeId === id ? items[0].id : store.activeId, conversations: items };
}
export function modelMessages(messages: LocalMessage[]) {
  let remaining = 140_000;
  const selected: LocalMessage[] = [];
  for (const message of messages.filter(item => item.role === "user" || item.state === "complete").slice(-60).toReversed()) {
    const size = message.content.length + (message.attachments || []).reduce((sum, item) => sum + (item.text?.length || 0), 0);
    if (size > remaining) break;
    selected.unshift(message); remaining -= size;
  }
  return selected.map(message => {
    const unavailableImages = (message.attachments || []).filter(item => item.mimeType.startsWith("image/") && !item.dataUrl).map(item => item.name);
    const notice = unavailableImages.length ? `\n[Lampiran gambar ${unavailableImages.join(", ")} tidak tersedia lagi di riwayat. Minta unggah ulang bila diperlukan.]` : "";
    return { role: message.role, content: `${message.content}${notice}`.slice(0, 24_000), ...(message.attachments?.length ? { attachments: message.attachments.filter(item => item.text || item.dataUrl) } : {}) };
  });
}
export function retryMessages(messages: LocalMessage[]): LocalMessage[] {
  const lastUser = messages.findLastIndex(item => item.role === "user");
  return lastUser < 0 ? [] : messages.slice(0, lastUser + 1);
}
