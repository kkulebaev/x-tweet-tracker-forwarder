import { describe, expect, it } from 'vitest';
import { shouldEnableLinkPreview } from '../src/link-preview.js';

const sourceTweetUrl = 'https://x.com/kkulebaev/status/12345';

describe('shouldEnableLinkPreview', () => {
  it('enables preview for text-only message with a single source tweet URL', () => {
    const decision = shouldEnableLinkPreview({
      mode: 'text',
      message: '<b>Заголовок</b>\n\nРазбор мысли\n\nhttps://x.com/kkulebaev/status/12345',
      sourceTweetUrl,
    });

    expect(decision).toEqual({
      enabled: true,
      reason: 'single_content_url_matches_source_tweet',
      contentUrlCount: 1,
    });
  });

  it('disables preview when there is an extra content-level URL', () => {
    const decision = shouldEnableLinkPreview({
      mode: 'text',
      message: '<b>Заголовок</b>\n\nhttps://x.com/kkulebaev/status/12345\n\nhttps://example.com/article',
      sourceTweetUrl,
    });

    expect(decision).toEqual({
      enabled: false,
      reason: 'multiple_content_urls',
      contentUrlCount: 2,
    });
  });

  it('keeps preview enabled for long text when the only content-level URL is the source tweet', () => {
    const longParagraph = 'Очень длинный текст '.repeat(40).trim();
    const decision = shouldEnableLinkPreview({
      mode: 'text',
      message: `<b>Заголовок</b>\n\n${longParagraph}\n\nhttps://x.com/kkulebaev/status/12345`,
      sourceTweetUrl,
    });

    expect(decision).toEqual({
      enabled: true,
      reason: 'single_content_url_matches_source_tweet',
      contentUrlCount: 1,
    });
  });

  it('keeps preview enabled for text fallback after image failure', () => {
    const decision = shouldEnableLinkPreview({
      mode: 'text',
      message: '<b>Заголовок</b>\n\nФолбэк после неудачной генерации изображения\n\nhttps://x.com/kkulebaev/status/12345',
      sourceTweetUrl,
    });

    expect(decision).toEqual({
      enabled: true,
      reason: 'single_content_url_matches_source_tweet',
      contentUrlCount: 1,
    });
  });

  it('disables preview for photo delivery modes', () => {
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

    expect(sourcePhotoDecision).toEqual({
      enabled: false,
      reason: 'non_text_delivery_mode',
      contentUrlCount: 0,
    });
    expect(generatedPhotoDecision).toEqual({
      enabled: false,
      reason: 'non_text_delivery_mode',
      contentUrlCount: 0,
    });
  });

  it('treats x.com and twitter.com source URLs as equivalent', () => {
    const decision = shouldEnableLinkPreview({
      mode: 'text',
      message: '<b>Заголовок</b>\n\nhttps://twitter.com/kkulebaev/status/12345?s=46',
      sourceTweetUrl,
    });

    expect(decision).toEqual({
      enabled: true,
      reason: 'single_content_url_matches_source_tweet',
      contentUrlCount: 1,
    });
  });

  it('ignores mention links when deciding preview eligibility', () => {
    const decision = shouldEnableLinkPreview({
      mode: 'text',
      message: '<b>Заголовок</b>\n\nСпасибо <a href="https://x.com/someone">@someone</a> за мысль\n\nhttps://x.com/kkulebaev/status/12345',
      sourceTweetUrl,
    });

    expect(decision).toEqual({
      enabled: true,
      reason: 'single_content_url_matches_source_tweet',
      contentUrlCount: 1,
    });
  });
});
