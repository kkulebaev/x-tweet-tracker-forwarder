import { describe, expect, it } from 'vitest';
import { selectRandomArchetype } from '../src/archetype-selector.js';
import { rewriteConfig } from '../src/rewrite-config.js';

describe('selectRandomArchetype', () => {
  it('throws when there are no archetypes', () => {
    expect(() => selectRandomArchetype([], () => 0.5)).toThrow('At least one rewrite archetype is required');
  });

  it('selects the first archetype for negative or non-finite values', () => {
    const first = rewriteConfig.archetypes[0];

    expect(selectRandomArchetype(rewriteConfig.archetypes, () => -1)).toEqual(first);
    expect(selectRandomArchetype(rewriteConfig.archetypes, () => Number.NaN)).toEqual(first);
    expect(selectRandomArchetype(rewriteConfig.archetypes, () => Number.POSITIVE_INFINITY)).toEqual(first);
  });

  it('bounds the last bucket just below 1', () => {
    const last = rewriteConfig.archetypes[rewriteConfig.archetypes.length - 1];

    expect(selectRandomArchetype(rewriteConfig.archetypes, () => 0.9999999999999999)).toEqual(last);
    expect(selectRandomArchetype(rewriteConfig.archetypes, () => 1)).toEqual(last);
  });

  it('maps middle values into the expected bucket', () => {
    expect(selectRandomArchetype(rewriteConfig.archetypes, () => 0.21)).toEqual(rewriteConfig.archetypes[1]);
    expect(selectRandomArchetype(rewriteConfig.archetypes, () => 0.61)).toEqual(rewriteConfig.archetypes[3]);
  });
});
