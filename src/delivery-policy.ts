import { createHash } from 'node:crypto';
import type { StructuredTelegramPost } from './post-contract.js';
import type { TweetEventMedia, TweetEventPayload } from './redis.js';

const DELIVERY_TARGET_GENERATION_RATIO = 0.5;
const DELIVERY_PREVIEW_SAFE_MODE = 'conservative';
const DELIVERY_EXCLUDE_ANNOUNCEMENTS = true;

const ANNOUNCEMENT_PATTERNS = [
  /\b(launch(?:ed)?|released?|shipping|shipped|introducing|announce(?:d|ment)?|available now)\b/i,
  /\b(new post|new article|new blog|read more|just published|we built|we launched)\b/i,
  /\b(now live|is live|out now|today we|we are excited)\b/i,
];

const NEWS_PATTERNS = [
  /\b(breaking|update|news|psa|heads up|fyi)\b/i,
  /\b(rolled out|rollout|deprecated|deprecation|changed|change log|changelog)\b/i,
  /\b(available|support(?:s|ed)?|added|introduces?)\b/i,
];

const THREAD_PATTERNS = [/\b\d+\//, /(?:^|\n)\s*[-•]/, /\bthread\b/i];

type PreviewSafeMode = typeof DELIVERY_PREVIEW_SAFE_MODE;

export type RawTweetSignals = {
  hasSingleSourcePhoto: boolean;
  hasAnyMedia: boolean;
  hasExternalLink: boolean;
  isAnnouncementLike: boolean;
  isNewsLike: boolean;
  isLinkPost: boolean;
  isPreviewSafe: boolean;
  isThreadLike: boolean;
  textLength: number;
};

export type GenerationBucket = 'generation' | 'no_generation';

export type DeliveryMode = 'source_photo' | 'generated_photo' | 'text_with_preview' | 'text';

export type DeliveryDecision = {
  mode: DeliveryMode;
  reasons: string[];
  isGenerationEligible: boolean;
  generationBucket: GenerationBucket | null;
  previewSafe: boolean;
};

function normalizeUrl(url: string) {
  return url.trim().replace(/[),.!?]+$/g, '');
}

function extractUrls(text: string) {
  const matches = text.match(/https?:\/\/\S+/gi) ?? [];
  return matches.map((match) => normalizeUrl(match));
}

function hasSingleSourcePhoto(media: TweetEventMedia[] | undefined) {
  if (!Array.isArray(media) || media.length !== 1) return false;

  const single = media[0];
  return Boolean(single && single.type === 'photo' && single.url.trim());
}

function hasAnyMedia(media: TweetEventMedia[] | undefined) {
  return Array.isArray(media) && media.some((item) => item.url.trim().length > 0);
}

function detectExternalLink(args: { text: string; tweetUrl: string }) {
  const urls = extractUrls(args.text);
  const canonicalTweetUrl = normalizeUrl(args.tweetUrl);

  return urls.some((url) => url !== canonicalTweetUrl);
}

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function isShortFactualText(text: string) {
  const normalized = text.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (normalized.length > 140) return false;
  const sentenceCount = normalized.split(/[.!?]+/).filter((part) => part.trim().length > 0).length;
  return sentenceCount <= 2;
}

function isPreviewSafeConservative(args: {
  hasAnyMedia: boolean;
  hasExternalLink: boolean;
  isThreadLike: boolean;
  text: string;
}) {
  if (args.hasAnyMedia) return false;
  if (args.hasExternalLink) return false;
  if (args.isThreadLike) return false;

  const cleaned = args.text.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return false;

  return cleaned.length <= 220;
}

export function classifyRawTweet(payload: TweetEventPayload): RawTweetSignals {
  const text = payload.text.trim();
  const threadLike = matchesAny(text, THREAD_PATTERNS);
  const externalLink = detectExternalLink({ text, tweetUrl: payload.url });
  const announcementLike = matchesAny(text, ANNOUNCEMENT_PATTERNS);
  const newsLike = !announcementLike && matchesAny(text, NEWS_PATTERNS) && isShortFactualText(text);
  const linkPost = externalLink;
  const anyMedia = hasAnyMedia(payload.media);

  const previewSafe =
    DELIVERY_PREVIEW_SAFE_MODE === 'conservative'
      ? isPreviewSafeConservative({
          hasAnyMedia: anyMedia,
          hasExternalLink: externalLink,
          isThreadLike: threadLike,
          text,
        })
      : false;

  return {
    hasSingleSourcePhoto: hasSingleSourcePhoto(payload.media),
    hasAnyMedia: anyMedia,
    hasExternalLink: externalLink,
    isAnnouncementLike: announcementLike,
    isNewsLike: newsLike,
    isLinkPost: linkPost,
    isPreviewSafe: previewSafe,
    isThreadLike: threadLike,
    textLength: text.length,
  };
}

export function isGenerationEligible(args: { rawSignals: RawTweetSignals; post: StructuredTelegramPost }) {
  const reasons: string[] = [];

  if (args.rawSignals.hasSingleSourcePhoto) {
    reasons.push('source_photo_present');
  }

  if (DELIVERY_EXCLUDE_ANNOUNCEMENTS && args.rawSignals.isAnnouncementLike) {
    reasons.push('announcement_like');
  }

  if (args.rawSignals.isNewsLike) {
    reasons.push('news_like');
  }

  if (args.rawSignals.isLinkPost) {
    reasons.push('link_post');
  }

  return {
    value: reasons.length === 0,
    reasons,
  };
}

export function pickGenerationBucket(seed: string, ratio = DELIVERY_TARGET_GENERATION_RATIO): GenerationBucket {
  const hash = createHash('sha256').update(seed).digest();
  const numeric = hash.readUInt32BE(0) / 0xffffffff;
  return numeric < ratio ? 'generation' : 'no_generation';
}

export function decideDeliveryMode(args: {
  rawSignals: RawTweetSignals;
  post: StructuredTelegramPost;
  canUsePhotoCaption: boolean;
  imageGenerationEnabled: boolean;
  generationSeed: string;
}) : DeliveryDecision {
  const reasons: string[] = [];
  const eligibility = isGenerationEligible({ rawSignals: args.rawSignals, post: args.post });
  const generationBucket = eligibility.value ? pickGenerationBucket(args.generationSeed) : null;

  if (args.rawSignals.hasSingleSourcePhoto && args.canUsePhotoCaption) {
    reasons.push('source_photo_present', 'caption_within_photo_limit');
    return {
      mode: 'source_photo',
      reasons,
      isGenerationEligible: eligibility.value,
      generationBucket,
      previewSafe: args.rawSignals.isPreviewSafe,
    };
  }

  if (args.rawSignals.hasSingleSourcePhoto && !args.canUsePhotoCaption) {
    reasons.push('source_photo_present', 'caption_exceeds_photo_limit');
  }

  if (!eligibility.value) {
    reasons.push(...eligibility.reasons);
  }

  if (!args.canUsePhotoCaption) {
    reasons.push('caption_exceeds_photo_limit');
  }

  if (!args.imageGenerationEnabled) {
    reasons.push('image_generation_disabled');
  }

  if (eligibility.value && generationBucket === 'generation' && args.canUsePhotoCaption && args.imageGenerationEnabled) {
    reasons.push('eligible_for_generation', 'generation_bucket_selected');
    return {
      mode: 'generated_photo',
      reasons,
      isGenerationEligible: eligibility.value,
      generationBucket,
      previewSafe: args.rawSignals.isPreviewSafe,
    };
  }

  if (eligibility.value && generationBucket === 'no_generation') {
    reasons.push('eligible_for_generation', 'no_generation_bucket_selected');
  }

  if (args.rawSignals.isPreviewSafe) {
    reasons.push('preview_safe');
    return {
      mode: 'text_with_preview',
      reasons,
      isGenerationEligible: eligibility.value,
      generationBucket,
      previewSafe: args.rawSignals.isPreviewSafe,
    };
  }

  reasons.push('preview_not_safe');
  return {
    mode: 'text',
    reasons,
    isGenerationEligible: eligibility.value,
    generationBucket,
    previewSafe: args.rawSignals.isPreviewSafe,
  };
}
