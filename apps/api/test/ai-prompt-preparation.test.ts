import test from 'node:test';
import assert from 'node:assert/strict';
import { chatRequestSchema } from '@aet/contracts';
import type { ProviderMessage } from '../src/ai/provider.js';
import { fitConversationContext } from '../src/ai/prompting/context-manager.js';
import { preparePrompt } from '../src/ai/prompting/prompt-builder.js';
import { classifyHybridHeuristically } from '../src/ai/routing/hybrid-router.js';

const request = (messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
  chatRequestSchema.parse({ persona: 'daily', effort: 'normal', messages });

test('prompt preparation preserves the latest user request and applies task guidance', () => {
  const input = request([{ role: 'user', content: 'Buat analisis regresi data panel. Jangan menggunakan tabel.' }]);
  const task = classifyHybridHeuristically(input);
  const prepared = preparePrompt(input, 'System baseline.', task, { maxContextCharacters: 20_000 });
  assert.match(String(prepared.messages[0]?.content), /Panduan tugas terarah/);
  assert.match(String(prepared.messages[0]?.content), /batasan eksplisit/);
  assert.equal(prepared.messages.at(-1)?.content instanceof Array, false);
  assert.equal(String(prepared.messages.at(-1)?.content), 'Buat analisis regresi data panel. Jangan menggunakan tabel.');
  assert.equal(prepared.metrics.omittedMessageCount, 0);
  assert.equal(prepared.metrics.taskGuidanceApplied, true);
});

test('context fitting drops oldest complete turns and retains chronological order', () => {
  const system: ProviderMessage = { role: 'system', content: 'system' };
  const conversation: ProviderMessage[] = [
    { role: 'user', content: 'old question'.repeat(20) },
    { role: 'assistant', content: 'old answer'.repeat(20) },
    { role: 'user', content: 'recent question' },
    { role: 'assistant', content: 'recent answer' },
    { role: 'user', content: 'latest question' },
  ];
  const fitted = fitConversationContext(system, conversation, { maxContextCharacters: 220, reserveCharacters: 0 });
  assert.equal(fitted.messages[0]?.role, 'system');
  assert.equal(fitted.messages.at(-1)?.content, 'latest question');
  assert.ok(fitted.omittedMessages >= 2);
  assert.ok(fitted.messages.find(message => String(message.content).includes('pesan lama tidak disertakan')));
  assert.ok(fitted.messages.some(message => message.content === 'recent question'));
  assert.ok(fitted.messages.some(message => message.content === 'recent answer'));
  assert.ok(!fitted.messages.some(message => String(message.content).includes('old question')));
  const estimated = fitted.messages.reduce((total, message) =>
    total + (typeof message.content === 'string'
      ? message.content.length
      : message.content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0)), 0);
  assert.ok(estimated <= 220);
});

test('context fitting never silently truncates an oversized latest user turn', () => {
  const system: ProviderMessage = { role: 'system', content: 'system' };
  const conversation: ProviderMessage[] = [{ role: 'user', content: 'x'.repeat(100) }];
  assert.throws(
    () => fitConversationContext(system, conversation, { maxContextCharacters: 50, reserveCharacters: 0 }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'PROMPT_CONTEXT_LIMIT',
  );
});

test('image attachment payload remains attached to the latest user message', () => {
  const input = chatRequestSchema.parse({
    persona: 'daily', effort: 'normal',
    messages: [{ role: 'user', content: 'Jelaskan gambar ini', attachments: [{ id: 'img', name: 'image.png', mimeType: 'image/png', size: 24, dataUrl: 'data:image/png;base64,AAAA' }] }],
  });
  const task = classifyHybridHeuristically(input);
  const prepared = preparePrompt(input, 'System baseline.', task, { maxContextCharacters: 20_000 });
  const latest = prepared.messages.at(-1)!;
  assert.ok(Array.isArray(latest.content));
  assert.ok(latest.content.some(part => part.type === 'image_url'));
});
