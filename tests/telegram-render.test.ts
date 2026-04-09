import { describe, expect, it } from 'vitest';
import {
  buildFallbackStructuredPost,
  canSendAsPhotoCaption,
  renderTelegramCaption,
  renderTelegramMessage,
  renderTelegramPost,
} from '../src/telegram-render.js';
import type { StructuredTelegramPost } from '../src/post-contract.js';

function makePost(overrides?: Partial<StructuredTelegramPost>): StructuredTelegramPost {
  return {
    archetype: 'mini-list',
    titleEmoji: '⚡',
    title: 'Что нового у @kkulebaev',
    bodyBlocks: [
      { type: 'paragraph', text: 'Первый абзац с <углами> и @someone' },
      { type: 'storyBeat', text: 'Короткая история' },
      { type: 'punchline', text: 'Резкий вывод' },
      { type: 'takeaway', text: 'Практический вывод' },
    ],
    cta: { text: 'А ты бы так сделал?' },
    imageBrief: {
      concept: 'editorial illustration',
      style: 'clean digital art',
    },
    sourceTweetId: 'tweet-1',
    configVersion: 'v2',
    ...overrides,
  };
}

describe('telegram render helpers', () => {
  it('renders HTML-safe post content and appends the URL when requested', () => {
    const rendered = renderTelegramPost({
      post: makePost(),
      includeUrl: true,
      url: 'https://x.com/kkulebaev/status/1?x=1&y=2',
    });

    expect(rendered).toContain('⚡ <b>Что нового у <a href="https://x.com/kkulebaev">@kkulebaev</a></b>');
    expect(rendered).toContain('Первый абзац с &lt;углами&gt; и <a href="https://x.com/someone">@someone</a>');
    expect(rendered).toContain('<i>Короткая история</i>');
    expect(rendered).toContain('<b>Резкий вывод</b>');
    expect(rendered).toContain('💡 Практический вывод');
    expect(rendered).toContain('<i>А ты бы так сделал?</i>');
    expect(rendered).toContain('https://x.com/kkulebaev/status/1?x=1&amp;y=2');
  });

  it('does not italicize CTA when it is not a question', () => {
    const rendered = renderTelegramPost({
      post: makePost({ cta: { text: 'Обсудим в комментах' } }),
      includeUrl: false,
    });

    expect(rendered).toContain('Обсудим в комментах');
    expect(rendered).not.toContain('<i>Обсудим в комментах</i>');
  });

  it('compacts long captions below the photo limit', () => {
    const rendered = renderTelegramCaption({
      post: makePost({
        bodyBlocks: [
          { type: 'list', items: ['Пункт 1', 'Пункт 2', 'Пункт 3', 'Пункт 4'] },
          { type: 'paragraph', text: 'Очень длинный абзац '.repeat(80).trim() },
          { type: 'paragraph', text: 'Еще один длинный абзац '.repeat(60).trim() },
        ],
        cta: { text: 'Очень длинный вопрос '.repeat(12).trim() + '?' },
      }),
    });

    expect(rendered.length).toBeLessThanOrEqual(1024);
    expect(rendered).toContain('• Пункт 1');
    expect(rendered).not.toContain('• Пункт 4');
  });

  it('compacts long messages below the message target and preserves the source URL', () => {
    const rendered = renderTelegramMessage({
      post: makePost({
        bodyBlocks: [
          { type: 'paragraph', text: 'Очень длинный абзац '.repeat(120).trim() },
          { type: 'paragraph', text: 'Второй длинный абзац '.repeat(120).trim() },
          { type: 'paragraph', text: 'Третий длинный абзац '.repeat(120).trim() },
          { type: 'paragraph', text: 'Четвертый длинный абзац '.repeat(120).trim() },
        ],
      }),
      url: 'https://x.com/kkulebaev/status/1',
    });

    expect(rendered.length).toBeLessThanOrEqual(1401);
    expect(rendered).toContain('https://x.com/kkulebaev/status/1');
  });

  it('adds a final ellipsis when even the compacted message is still too long', () => {
    const rendered = renderTelegramMessage({
      post: makePost({
        bodyBlocks: [{ type: 'paragraph', text: 'Коротко' }],
        cta: null,
      }),
      url: `https://x.com/kkulebaev/status/1?blob=${'a'.repeat(2000)}`,
    });

    expect(rendered.endsWith('…')).toBe(true);
    expect(rendered.length).toBeLessThanOrEqual(1401);
  });

  it('returns an ellipsis-only caption decision for extremely small max branches via fallback post content', () => {
    const fallback = buildFallbackStructuredPost({
      xUsername: 'kkulebaev',
      text: 'x'.repeat(500),
    });

    const rendered = renderTelegramCaption({
      post: {
        ...fallback,
        bodyBlocks: [{ type: 'paragraph', text: 'x'.repeat(1500) }],
        cta: { text: 'y'.repeat(200) },
      },
    });

    expect(rendered.length).toBeLessThanOrEqual(1024);
  });

  it('checks whether text fits into a photo caption', () => {
    expect(canSendAsPhotoCaption('a'.repeat(1024))).toBe(true);
    expect(canSendAsPhotoCaption('a'.repeat(1025))).toBe(false);
  });

  it('builds a normalized fallback structured post', () => {
    const fallback = buildFallbackStructuredPost({
      xUsername: null,
      text: '  текст   с   лишними   пробелами  ',
    });

    expect(fallback).toEqual({
      archetype: 'plain-punchline',
      titleEmoji: '🧠',
      title: 'Что нового у @unknown',
      bodyBlocks: [
        {
          type: 'paragraph',
          text: 'текст с лишними пробелами',
        },
        {
          type: 'takeaway',
          text: 'Здесь лучше смотреть на сам тезис и проверять, как он ложится на реальную фронтенд-практику.',
        },
      ],
      cta: {
        text: 'Что думаешь об этом подходе?',
      },
      imageBrief: {
        concept: 'editorial illustration about a frontend development idea from a tweet',
        style: 'modern clean digital editorial illustration with subtle drama',
      },
      sourceTweetId: 'unknown',
      configVersion: 'fallback-v1',
    });
  });
});
