import type { RewriteArchetype } from './rewrite-config.js';

export type RandomFn = () => number;

export function selectRandomArchetype(archetypes: RewriteArchetype[], random: RandomFn = Math.random) {
  if (archetypes.length === 0) {
    throw new Error('At least one rewrite archetype is required');
  }

  const normalized = random();
  const bounded = Number.isFinite(normalized) ? Math.min(Math.max(normalized, 0), 0.9999999999999999) : 0;
  const index = Math.floor(bounded * archetypes.length);

  return archetypes[index] ?? archetypes[0];
}
