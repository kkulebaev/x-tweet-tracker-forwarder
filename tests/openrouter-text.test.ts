import { describe, expect, it } from 'vitest';
import { INVALID_STRUCTURED_POST_ERROR_PREFIX, isInvalidStructuredPostError } from '../src/openrouter-text.js';

describe('isInvalidStructuredPostError', () => {
  it('matches invalid structured post errors by prefix', () => {
    const error = new Error(`${INVALID_STRUCTURED_POST_ERROR_PREFIX} bodyBlocks must contain at least 1 valid block`);

    expect(isInvalidStructuredPostError(error)).toBe(true);
  });

  it('ignores other errors', () => {
    expect(isInvalidStructuredPostError(new Error('OpenRouter request failed'))).toBe(false);
    expect(isInvalidStructuredPostError('OpenRouter returned invalid structured post')).toBe(false);
  });
});
