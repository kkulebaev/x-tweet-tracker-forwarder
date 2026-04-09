import type { DeliveryMode } from './delivery-policy.js';

export type LinkPreviewReason =
  | 'non_text_delivery_mode'
  | 'no_content_urls'
  | 'multiple_content_urls'
  | 'single_content_url_not_source_tweet'
  | 'single_content_url_matches_source_tweet';

export type LinkPreviewDecision = {
  enabled: boolean;
  reason: LinkPreviewReason;
  contentUrlCount: number;
};

function stripTrailingUrlNoise(url: string) {
  return url.trim().replace(/[),.!?]+$/g, '');
}

function normalizeHost(host: string) {
  const lowered = host.toLowerCase();
  const withoutWww = lowered.startsWith('www.') ? lowered.slice(4) : lowered;
  return withoutWww === 'twitter.com' ? 'x.com' : withoutWww;
}

function normalizeSearchParams(params: URLSearchParams) {
  const normalized = new URLSearchParams();

  for (const [key, value] of params.entries()) {
    const lowered = key.toLowerCase();
    if (lowered.startsWith('utm_')) continue;
    if (lowered === 's') continue;
    if (lowered === 't') continue;
    if (lowered === 'ref_src') continue;
    if (lowered === 'ref_url') continue;
    normalized.append(key, value);
  }

  normalized.sort();
  const serialized = normalized.toString();
  return serialized ? `?${serialized}` : '';
}

export function canonicalizeUrl(rawUrl: string) {
  const sanitized = stripTrailingUrlNoise(rawUrl).replaceAll('&amp;', '&');

  try {
    const parsed = new URL(sanitized);
    const protocol = parsed.protocol.toLowerCase();
    const host = normalizeHost(parsed.hostname);
    const pathname = parsed.pathname.replace(/\/+$/g, '') || '/';
    const search = normalizeSearchParams(parsed.searchParams);

    return `${protocol}//${host}${pathname}${search}`;
  } catch {
    return sanitized;
  }
}

function isMentionAnchor(anchorText: string) {
  const normalized = anchorText.replace(/<[^>]+>/g, '').trim();
  return /^@[A-Za-z0-9_]{1,15}$/.test(normalized);
}

function extractAnchorUrls(message: string) {
  const urls: string[] = [];
  const anchorRe = /<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of message.matchAll(anchorRe)) {
    const href = match[1];
    const anchorText = match[2] ?? '';

    if (!href || isMentionAnchor(anchorText)) {
      continue;
    }

    urls.push(href);
  }

  return urls;
}

function stripHtmlTags(message: string) {
  return message.replace(/<[^>]+>/g, ' ');
}

function extractPlainTextUrls(message: string) {
  const plainText = stripHtmlTags(message).replaceAll('&amp;', '&');
  const matches = plainText.match(/https?:\/\/\S+/gi) ?? [];
  return matches.map((match) => stripTrailingUrlNoise(match));
}

function extractContentLevelUrls(message: string) {
  return [...extractAnchorUrls(message), ...extractPlainTextUrls(message)];
}

export function shouldEnableLinkPreview(args: {
  mode: DeliveryMode;
  message: string;
  sourceTweetUrl: string;
}): LinkPreviewDecision {
  if (args.mode !== 'text') {
    return {
      enabled: false,
      reason: 'non_text_delivery_mode',
      contentUrlCount: 0,
    };
  }

  const contentUrls = extractContentLevelUrls(args.message).map((url) => canonicalizeUrl(url));

  if (contentUrls.length === 0) {
    return {
      enabled: false,
      reason: 'no_content_urls',
      contentUrlCount: 0,
    };
  }

  if (contentUrls.length !== 1) {
    return {
      enabled: false,
      reason: 'multiple_content_urls',
      contentUrlCount: contentUrls.length,
    };
  }

  const sourceTweetUrl = canonicalizeUrl(args.sourceTweetUrl);
  const [singleContentUrl] = contentUrls;

  if (singleContentUrl !== sourceTweetUrl) {
    return {
      enabled: false,
      reason: 'single_content_url_not_source_tweet',
      contentUrlCount: 1,
    };
  }

  return {
    enabled: true,
    reason: 'single_content_url_matches_source_tweet',
    contentUrlCount: 1,
  };
}
