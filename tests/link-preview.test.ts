import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldEnableLinkPreview } from '../src/link-preview.js';

const sourceTweetUrl = 'https://x.com/kkulebaev/status/12345';

test('enables preview for text-only message with a single source tweet URL', () => {
  const decision = shouldEnableLinkPreview({
    mode: 'text',
    message: '<b>Заголовок</b>\n\nРазбор мысли\n\nhttps://x.com/kkulebaev/status/12345',
    sourceTweetUrl,
  });

  assert.deepEqual(decision, {
    enabled: true,
    reason: 'single_content_url_matches_source_tweet',
    contentUrlCount: 1,
  });
});

test('disables preview when there is an extra content-level URL', () => {
  const decision = shouldEnableLinkPreview({
    mode: 'text',
    message: '<b>Заголовок</b>\n\nhttps://x.com/kkulebaev/status/12345\n\nhttps://example.com/article',
    sourceTweetUrl,
  });

  assert.deepEqual(decision, {
    enabled: false,
    reason: 'multiple_content_urls',
    contentUrlCount: 2,
  });
});

test('keeps preview enabled for long text when the only content-level URL is the source tweet', () => {
  const longParagraph = 'Очень длинный текст '.repeat(40).trim();
  const decision = shouldEnableLinkPreview({
    mode: 'text',
    message: `<b>Заголовок</b>\n\n${longParagraph}\n\nhttps://x.com/kkulebaev/status/12345`,
    sourceTweetUrl,
  });

  assert.deepEqual(decision, {
    enabled: true,
    reason: 'single_content_url_matches_source_tweet',
    contentUrlCount: 1,
  });
});

test('keeps preview enabled for text fallback after image failure', () => {
  const decision = shouldEnableLinkPreview({
    mode: 'text',
    message: '<b>Заголовок</b>\n\nФолбэк после неудачной генерации изображения\n\nhttps://x.com/kkulebaev/status/12345',
    sourceTweetUrl,
  });

  assert.deepEqual(decision, {
    enabled: true,
    reason: 'single_content_url_matches_source_tweet',
    contentUrlCount: 1,
  });
});

test('disables preview for photo delivery modes', () => {
  const sourcePhotoDecision = shouldEnableLinkPreview({
    mode: 'source_photo',
    message: 'https://x.com/kkulebaev/status/12345',
    sourceTweetUrl,
  });
  const generatedPhotoDecision = shouldEnableLinkPreview({
    mode: 'generated_photo',
    message: 'https://x.com/kkulebaev/status/12345',
    sourceTweetUrl,
  });

  assert.deepEqual(sourcePhotoDecision, {
    enabled: false,
    reason: 'non_text_delivery_mode',
    contentUrlCount: 0,
  });
  assert.deepEqual(generatedPhotoDecision, {
    enabled: false,
    reason: 'non_text_delivery_mode',
    contentUrlCount: 0,
  });
});

test('treats x.com and twitter.com source URLs as equivalent', () => {
  const decision = shouldEnableLinkPreview({
    mode: 'text',
    message: '<b>Заголовок</b>\n\nhttps://twitter.com/kkulebaev/status/12345?s=46',
    sourceTweetUrl,
  });

  assert.deepEqual(decision, {
    enabled: true,
    reason: 'single_content_url_matches_source_tweet',
    contentUrlCount: 1,
  });
});

test('ignores mention links when deciding preview eligibility', () => {
  const decision = shouldEnableLinkPreview({
    mode: 'text',
    message: '<b>Заголовок</b>\n\nСпасибо <a href="https://x.com/someone">@someone</a> за мысль\n\nhttps://x.com/kkulebaev/status/12345',
    sourceTweetUrl,
  });

  assert.deepEqual(decision, {
    enabled: true,
    reason: 'single_content_url_matches_source_tweet',
    contentUrlCount: 1,
  });
});
