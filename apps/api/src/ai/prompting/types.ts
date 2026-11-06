import type { ProviderMessage } from '../provider.js';

export type PromptPreparationMetrics = {
  originalMessageCount: number;
  includedMessageCount: number;
  omittedMessageCount: number;
  estimatedContextCharacters: number;
  contextBudgetCharacters: number;
  taskGuidanceApplied: boolean;
};

export type PreparedPrompt = {
  messages: ProviderMessage[];
  metrics: PromptPreparationMetrics;
};
