import { describe, expect, it } from 'vitest';
import { parseStructuredTelegramPost } from '../src/post-contract.js';

const validPayload = {
  archetype: 'mini-list',
  titleEmoji: '🔥',
  title: '  короткий заголовок ',
  bodyBlocks: [
    { type: 'paragraph', text: '  Первый блок  ' },
    { type: 'list', items: [' один ', 'два', '', 3] },
    { type: 'takeaway', text: ' Практический вывод ' },
  ],
  cta: { text: ' Что думаешь? ' },
  imageBrief: {
    concept: ' concept ',
    style: ' style ',
  },
  sourceTweetId: ' tweet-1 ',
  configVersion: ' v2 ',
};

describe('parseStructuredTelegramPost', () => {
  it('parses and normalizes a valid structured post', () => {
    const result = parseStructuredTelegramPost(JSON.stringify(validPayload), {
      archetype: 'mini-list',
      configVersion: 'v2',
      sourceTweetId: 'tweet-1',
      allowedBlockTypes: ['paragraph', 'list', 'takeaway'],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        archetype: 'mini-list',
        titleEmoji: '🔥',
        title: 'Короткий заголовок',
        bodyBlocks: [
          { type: 'paragraph', text: 'Первый блок' },
          { type: 'list', items: ['один', 'два'] },
          { type: 'takeaway', text: 'Практический вывод' },
        ],
        cta: { text: 'Что думаешь?' },
        imageBrief: {
          concept: 'concept',
          style: 'style',
        },
        sourceTweetId: 'tweet-1',
        configVersion: 'v2',
      },
    });
  });

  it('returns a JSON error for invalid input', () => {
    expect(parseStructuredTelegramPost('{oops')).toEqual({
      ok: false,
      errors: ['response is not valid JSON'],
    });
  });

  it('treats array payloads as invalid structured posts and reports field-level errors', () => {
    expect(parseStructuredTelegramPost(JSON.stringify(['not-an-object']))).toEqual({
      ok: false,
      errors: [
        'archetype is required',
        'titleEmoji is required',
        'title is required',
        'bodyBlocks must contain at least 1 valid block',
        'imageBrief is required',
        'imageBrief.concept is required',
        'imageBrief.style is required',
        'sourceTweetId is required',
        'configVersion is required',
      ],
    });
  });

  it('collects validation errors for missing and mismatched fields', () => {
    const result = parseStructuredTelegramPost(
      JSON.stringify({
        archetype: 'plain-punchline',
        titleEmoji: ' ',
        title: '',
        bodyBlocks: [
          { type: 'storyBeat', text: 'история' },
          { type: 'paragraph', text: 'параграф' },
          { type: 'paragraph', text: 'еще' },
          { type: 'paragraph', text: 'и еще' },
          { type: 'paragraph', text: 'слишком много' },
        ],
        cta: { text: ' ' },
        imageBrief: { concept: '', style: '' },
        sourceTweetId: 'other-id',
        configVersion: 'other-version',
      }),
      {
        archetype: 'mini-list',
        configVersion: 'v2',
        sourceTweetId: 'tweet-1',
        allowedBlockTypes: ['paragraph', 'list'],
      },
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        'archetype must equal mini-list',
        'titleEmoji is required',
        'title is required',
        'bodyBlocks must contain at most 4 items',
        'bodyBlocks contains disallowed block type: storyBeat',
        'cta must be null or an object with non-empty text',
        'imageBrief.concept is required',
        'imageBrief.style is required',
        'sourceTweetId must equal tweet-1',
        'configVersion must equal v2',
      ],
    });
  });

  it('rejects disallowed block types after normalization', () => {
    const result = parseStructuredTelegramPost(
      JSON.stringify({
        ...validPayload,
        bodyBlocks: [{ type: 'storyBeat', text: 'сюжетный блок' }],
      }),
      {
        allowedBlockTypes: ['paragraph', 'list', 'takeaway'],
      },
    );

    expect(result).toEqual({
      ok: false,
      errors: ['bodyBlocks contains disallowed block type: storyBeat'],
    });
  });

  it('requires at least one valid body block and imageBrief object', () => {
    const result = parseStructuredTelegramPost(
      JSON.stringify({
        ...validPayload,
        bodyBlocks: [{ type: 'list', items: [] }, { type: 'paragraph', text: '   ' }],
        imageBrief: null,
      }),
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        'bodyBlocks must contain at least 1 valid block',
        'imageBrief is required',
        'imageBrief.concept is required',
        'imageBrief.style is required',
      ],
    });
  });
});
