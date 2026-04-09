import { describe, expect, it } from 'vitest';
import { classifyRawTweet, decideDeliveryMode, isGenerationEligible, pickGenerationBucket } from '../src/delivery-policy.js';
import type { StructuredTelegramPost } from '../src/post-contract.js';
import type { TweetEventPayload } from '../src/redis.js';

function makePayload(overrides?: Partial<TweetEventPayload>): TweetEventPayload {
  return {
    type: 'tweet',
    tweetId: 'tweet-1',
    xUsername: 'kkulebaev',
    url: 'https://x.com/kkulebaev/status/1',
    text: 'This is a tweet about frontend trade-offs',
    createdAt: '2026-04-09T00:00:00Z',
    media: [],
    ...overrides,
  };
}

function makePost(): StructuredTelegramPost {
  return {
    archetype: 'mini-list',
    titleEmoji: '⚡',
    title: 'Заголовок',
    bodyBlocks: [{ type: 'paragraph', text: 'Текст' }],
    cta: null,
    imageBrief: {
      concept: 'concept',
      style: 'style',
    },
    sourceTweetId: 'tweet-1',
    configVersion: 'v2',
  };
}

describe('delivery policy', () => {
  it('classifies media, external links, announcements, news, and thread-like tweets', () => {
    const result = classifyRawTweet(
      makePayload({
        text: '1/ Breaking update: we launched this today https://example.com/post https://x.com/kkulebaev/status/1',
        media: [{ type: 'photo', url: 'https://img.example/photo.png', position: 1 }],
      }),
    );

    expect(result).toEqual({
      hasSingleSourcePhoto: true,
      hasAnyMedia: true,
      hasExternalLink: true,
      isAnnouncementLike: true,
      isNewsLike: false,
      isLinkPost: true,
      isThreadLike: true,
      textLength: '1/ Breaking update: we launched this today https://example.com/post https://x.com/kkulebaev/status/1'.length,
    });
  });

  it('detects short factual news tweets without announcement language', () => {
    const result = classifyRawTweet(
      makePayload({
        text: 'Update: browser support added for View Transitions.',
      }),
    );

    expect(result.isNewsLike).toBe(true);
    expect(result.isAnnouncementLike).toBe(false);
    expect(result.hasExternalLink).toBe(false);
  });

  it('marks generation as ineligible when raw signals include blocking reasons', () => {
    const eligibility = isGenerationEligible({
      rawSignals: {
        hasSingleSourcePhoto: true,
        hasAnyMedia: true,
        hasExternalLink: true,
        isAnnouncementLike: true,
        isNewsLike: true,
        isLinkPost: true,
        isThreadLike: false,
        textLength: 120,
      },
      post: makePost(),
    });

    expect(eligibility).toEqual({
      value: false,
      reasons: ['source_photo_present', 'announcement_like', 'news_like', 'link_post'],
    });
  });

  it('picks a deterministic generation bucket from the seed', () => {
    expect(pickGenerationBucket('alpha')).toBe(pickGenerationBucket('alpha'));
    expect(['generation', 'no_generation']).toContain(pickGenerationBucket('beta'));
    expect(pickGenerationBucket('gamma', 0)).toBe('no_generation');
    expect(pickGenerationBucket('gamma', 1)).toBe('generation');
  });

  it('prefers source photo delivery when a single source photo exists and caption fits', () => {
    const decision = decideDeliveryMode({
      rawSignals: classifyRawTweet(
        makePayload({
          media: [{ type: 'photo', url: 'https://img.example/photo.png', position: 1 }],
        }),
      ),
      post: makePost(),
      canUsePhotoCaption: true,
      imageGenerationEnabled: true,
      generationSeed: 'seed',
    });

    expect(decision).toEqual({
      mode: 'source_photo',
      reasons: ['source_photo_present', 'caption_within_photo_limit'],
      isGenerationEligible: false,
      generationBucket: null,
    });
  });

  it('uses generated photo delivery for eligible posts in the generation bucket', () => {
    const decision = decideDeliveryMode({
      rawSignals: classifyRawTweet(makePayload()),
      post: makePost(),
      canUsePhotoCaption: true,
      imageGenerationEnabled: true,
      generationSeed: 'b',
    });

    expect(decision.mode).toBe('generated_photo');
    expect(decision.isGenerationEligible).toBe(true);
    expect(decision.generationBucket).toBe('generation');
    expect(decision.reasons).toEqual(['eligible_for_generation', 'generation_bucket_selected']);
  });

  it('falls back to text delivery when caption is too long or image generation is unavailable', () => {
    const decision = decideDeliveryMode({
      rawSignals: classifyRawTweet(makePayload()),
      post: makePost(),
      canUsePhotoCaption: false,
      imageGenerationEnabled: false,
      generationSeed: 'b',
    });

    expect(decision.mode).toBe('text');
    expect(decision.isGenerationEligible).toBe(true);
    expect(decision.generationBucket).toBe('generation');
    expect(decision.reasons).toEqual(['caption_exceeds_photo_limit', 'image_generation_disabled', 'text_delivery']);
  });

  it('falls back to text delivery when the post lands in the no-generation bucket', () => {
    const decision = decideDeliveryMode({
      rawSignals: classifyRawTweet(makePayload()),
      post: makePost(),
      canUsePhotoCaption: true,
      imageGenerationEnabled: true,
      generationSeed: 'beta',
    });

    expect(decision.mode).toBe('text');
    expect(decision.isGenerationEligible).toBe(true);
    expect(decision.generationBucket).toBe('no_generation');
    expect(decision.reasons).toEqual(['eligible_for_generation', 'no_generation_bucket_selected', 'text_delivery']);
  });
});
