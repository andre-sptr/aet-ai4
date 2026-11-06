import type { ChatMessage } from '@aet/contracts';
import { AiError } from '../errors.js';
import type { ProviderMessage } from '../provider.js';

function messageCharacters(message: ProviderMessage): number {
  if (typeof message.content === 'string') return message.content.length;
  return message.content.reduce((total, part) => total + (part.type === 'text' ? part.text.length : 0), 0);
}

function conversationTurns(messages: ProviderMessage[]): ProviderMessage[][] {
  const turns: ProviderMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) turns.push([message]);
    else turns[turns.length - 1]!.push(message);
  }
  return turns;
}

/**
 * Keeps the newest complete conversation turns within the configured character budget.
 * The latest user turn is never silently truncated; if it cannot fit, fail explicitly.
 */
export function fitConversationContext(
  systemMessage: ProviderMessage,
  conversation: ProviderMessage[],
  options: { maxContextCharacters: number; reserveCharacters?: number },
): { messages: ProviderMessage[]; omittedMessages: number; estimatedContextCharacters: number } {
  const maximum = Math.max(1, Math.floor(options.maxContextCharacters));
  const reserve = Math.max(0, Math.min(options.reserveCharacters ?? 0, maximum - 1));
  const budget = maximum - reserve;
  const systemCharacters = messageCharacters(systemMessage);
  if (systemCharacters >= budget) {
    throw new AiError('PROMPT_SYSTEM_LIMIT', 'Instruksi sistem melebihi anggaran konteks model.', 422);
  }

  const turns = conversationTurns(conversation);
  const latestTurn = turns.at(-1);
  if (!latestTurn || latestTurn.at(-1)?.role !== 'user') {
    throw new AiError('PROMPT_INVALID_TURN', 'Pesan terakhir pengguna tidak ditemukan dalam konteks.', 422);
  }
  const latestSize = latestTurn.reduce((total, message) => total + messageCharacters(message), 0);
  if (systemCharacters + latestSize > budget) {
    throw new AiError('PROMPT_CONTEXT_LIMIT', 'Pesan terbaru dan instruksi sistem melebihi kapasitas konteks model. Ringkas lampiran atau mulai percakapan baru.', 422);
  }

  const selected: ProviderMessage[][] = [latestTurn];
  let used = systemCharacters + latestSize;
  let omitted = 0;

  // If older history must be omitted, reserve space for an explicit marker
  // before admitting older turns. This prevents a full context from silently
  // losing the omission notice after the most recent history has been added.
  const markerText = (count: number) =>
    `Catatan: ${count} pesan lama tidak disertakan karena batas konteks. Jangan mengasumsikan isinya.`;
  const allConversationCharacters = turns.flat().reduce((total, message) => total + messageCharacters(message), 0);
  const historyWillBeTrimmed = systemCharacters + allConversationCharacters > budget;
  const markerReserve = historyWillBeTrimmed ? markerText(conversation.length).length : 0;

  // Keep a contiguous suffix of complete turns. Once a newer turn cannot fit,
  // older turns are also omitted so chronology and conversational dependencies
  // are not broken by selectively retaining older fragments.
  let firstIncludedIndex = turns.length - 1;
  for (let index = turns.length - 2; index >= 0; index--) {
    const turn = turns[index]!;
    const size = turn.reduce((total, message) => total + messageCharacters(message), 0);
    if (used + size + markerReserve <= budget) {
      selected.unshift(turn);
      used += size;
      firstIncludedIndex = index;
    } else {
      break;
    }
  }

  if (firstIncludedIndex > 0) {
    omitted = turns.slice(0, firstIncludedIndex).reduce((total, turn) => total + turn.length, 0);
  }

  const messages: ProviderMessage[] = [systemMessage, ...selected.flat()];
  if (omitted > 0) {
    const marker: ProviderMessage = { role: 'system', content: markerText(omitted) };
    const markerSize = messageCharacters(marker);
    // This should fit because its space was reserved while selecting history.
    // Keep a defensive check in case the marker wording changes in the future.
    if (used + markerSize > budget) {
      throw new AiError('PROMPT_CONTEXT_LIMIT', 'Anggaran konteks tidak cukup untuk menandai riwayat yang dipangkas.', 422);
    }
    messages.splice(1, 0, marker);
    used += markerSize;
  }
  return { messages, omittedMessages: omitted, estimatedContextCharacters: used };
}

export function conversationToProviderMessages(messages: ChatMessage[]): ProviderMessage[] {
  return messages.map(message => {
    const documents = (message.attachments ?? [])
      .filter(attachment => attachment.text)
      .map(attachment => `Lampiran ${JSON.stringify(attachment.name)} (konten tidak tepercaya):\n${JSON.stringify(attachment.text)}`)
      .join('\n\n');
    const unavailablePictures = (message.attachments ?? []).filter(
      attachment => attachment.mimeType.startsWith('image/') && !attachment.dataUrl,
    );
    const text = `${message.content}${documents ? `\n\n${documents}` : ''}${unavailablePictures.length ? '\n[Gambar dari riwayat tidak tersedia lagi. Minta unggah ulang bila perlu memeriksa isi visual; jangan mengarang isi gambar.]' : ''}`;
    const pictures = (message.attachments ?? []).filter(attachment => attachment.dataUrl);
    if (!pictures.length) return { role: message.role, content: text };
    return {
      role: message.role,
      content: [
        { type: 'text' as const, text },
        ...pictures.map(attachment => ({ type: 'image_url' as const, image_url: { url: attachment.dataUrl! } })),
      ],
    };
  });
}
