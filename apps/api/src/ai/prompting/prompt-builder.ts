import type { ChatRequest } from '@aet/contracts';
import type { ProviderMessage } from '../provider.js';
import { conversationToProviderMessages, fitConversationContext } from './context-manager.js';
import { optimizeSystemPrompt } from './prompt-optimizer.js';
import type { PreparedPrompt } from './types.js';
import type { TaskProfile } from '../routing/hybrid-router.js';

export type PromptPreparationOptions = {
  maxContextCharacters: number;
  reserveCharacters?: number;
};

export function preparePrompt(
  request: ChatRequest,
  baseSystemPrompt: string,
  task: TaskProfile,
  options: PromptPreparationOptions,
): PreparedPrompt {
  const optimized = optimizeSystemPrompt(baseSystemPrompt, task, request);
  const systemMessage: ProviderMessage = { role: 'system', content: optimized.systemPrompt };
  const conversation = conversationToProviderMessages(request.messages);
  const fitted = fitConversationContext(systemMessage, conversation, options);
  return {
    messages: fitted.messages,
    metrics: {
      originalMessageCount: conversation.length,
      includedMessageCount: fitted.messages.filter(message => message.role !== 'system').length,
      omittedMessageCount: fitted.omittedMessages,
      estimatedContextCharacters: fitted.estimatedContextCharacters,
      contextBudgetCharacters: options.maxContextCharacters,
      taskGuidanceApplied: optimized.applied,
    },
  };
}
