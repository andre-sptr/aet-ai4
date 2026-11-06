import { MODEL_CATALOG, type ModelSpec } from '../models.js';

export type CapabilityName = 'general' | 'writing' | 'research' | 'coding' | 'math' | 'document' | 'image' | 'reasoning';
export type Availability = 'unknown' | 'available' | 'unavailable';

/** Runtime profile. Capability tags are configuration-derived, not benchmark claims. */
export type RegisteredModel = ModelSpec & {
  provider: 'sumopod';
  capabilities: readonly CapabilityName[];
  enabled: boolean;
  availability: Availability;
};

const capabilityMap: Record<string, readonly CapabilityName[]> = {
  'gpt-4o-mini': ['general', 'image'],
  'gpt-4.1-mini': ['general', 'writing', 'coding', 'research', 'document'],
  'gpt-5-mini': ['general', 'coding', 'math', 'research', 'reasoning'],
};

/**
 * Keep the existing catalog as the source of model IDs and provider parameters.
 * Unknown availability is intentionally eligible, matching legacy behavior;
 * only an explicitly unavailable model is excluded.
 */
export function getModelRegistry(
  catalog: readonly ModelSpec[] = MODEL_CATALOG,
  options: { disabledModelIds?: readonly string[]; availabilityByModel?: Readonly<Record<string, Availability>> } = {},
): RegisteredModel[] {
  const disabled = new Set(options.disabledModelIds ?? (process.env.SUMOPOD_DISABLED_MODELS ?? '').split(',').map(value => value.trim()).filter(Boolean));
  return catalog.map(model => ({
    ...model,
    provider: 'sumopod',
    capabilities: capabilityMap[model.id] ?? [...new Set<CapabilityName>([
      'general',
      ...model.strengths.filter((item): item is CapabilityName =>
        ['writing', 'research', 'coding', 'math', 'document', 'image', 'reasoning'].includes(item)),
      ...(model.speed === 'deep' ? ['reasoning' as const] : []),
      ...(model.vision ? ['image' as const] : []),
    ])],
    enabled: !disabled.has(model.id),
    availability: options.availabilityByModel?.[model.id] ?? 'unknown',
  }));
}

export function isModelEligible(model: RegisteredModel, requirements: { vision: boolean; contextCharacters: number }): boolean {
  return model.enabled
    && model.availability !== 'unavailable'
    && (!requirements.vision || model.vision)
    && requirements.contextCharacters <= model.maxContextCharacters;
}
