/** Operator-editable candidates, not a claim of availability on a Sumopod account.
 * Verify candidates manually in the protected model-test panel. Unknown native
 * reasoning/tool/JSON extensions are deliberately omitted from provider requests.
 */
export type ModelSpec = {
  id: string;
  strengths: readonly string[];
  speed: 'fast' | 'balanced' | 'deep';
  vision: boolean;
  maxContextCharacters: number;
  nativeReasoning?: 'reasoning_effort';
  outputTokenField?: 'max_tokens' | 'max_completion_tokens';
};
export const MODEL_CATALOG: readonly ModelSpec[] = [
  { id: 'gpt-4o-mini', strengths: ['general', 'image'], speed: 'fast', vision: true, maxContextCharacters: 96_000 },
  { id: 'gpt-4.1-mini', strengths: ['writing', 'coding', 'research'], speed: 'balanced', vision: false, maxContextCharacters: 96_000 },
  { id: 'gpt-5-mini', outputTokenField: 'max_completion_tokens', strengths: ['coding', 'math', 'research', 'general'], speed: 'deep', vision: false, maxContextCharacters: 96_000 },
];
export const SUMOPOD_ENDPOINT = 'https://ai.sumopod.com/v1/chat/completions';
export const MODEL_AVAILABILITY_NOTE = 'Model IDs are initial candidates from the supplied source. Current account support has not been verified. Native tools, structured-output and reasoning extensions remain disabled until confirmed in this configuration.';
