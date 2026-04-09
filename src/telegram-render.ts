import type { ListBlock, PostBodyBlock, StructuredTelegramPost } from './post-contract.js';

const TELEGRAM_PHOTO_CAPTION_MAX = 1024;
const TELEGRAM_PHOTO_CAPTION_TARGET = 900;
const TELEGRAM_MESSAGE_TARGET = 1400;
const X_MENTION_RE = /(^|[^\w])@([A-Za-z0-9_]{1,15})\b/g;

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderInlineText(text: string) {
  const escaped = escapeHtml(text);

  return escaped.replace(X_MENTION_RE, (match, prefix: string, username: string) => {
    const safePrefix = prefix ?? '';
    return `${safePrefix}<a href="https://x.com/${username}">@${username}</a>`;
  });
}

function shortenText(text: string, maxLength: number) {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 1) return '…';
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function shortenListBlock(block: ListBlock) {
  if (block.items.length === 0) return block;
  if (block.items.length === 1) {
    return {
      type: 'list',
      items: [shortenText(block.items[0], Math.max(24, block.items[0].length - 20))],
    } satisfies ListBlock;
  }

  return {
    type: 'list',
    items: block.items.slice(0, -1),
  } satisfies ListBlock;
}

function shortenBodyBlock(block: PostBodyBlock): PostBodyBlock {
  if (block.type === 'list') {
    return shortenListBlock(block);
  }

  return {
    ...block,
    text: shortenText(block.text, Math.max(40, block.text.length - 40)),
  };
}

function blockTextLength(block: PostBodyBlock) {
  if (block.type === 'list') {
    return block.items.join(' ').length;
  }

  return block.text.length;
}

function compactPost(post: StructuredTelegramPost): StructuredTelegramPost {
  let next: StructuredTelegramPost = {
    ...post,
    bodyBlocks: post.bodyBlocks.map((block) => (block.type === 'list' ? { ...block, items: [...block.items] } : { ...block })),
    cta: post.cta ? { ...post.cta } : null,
  };

  while (renderTelegramPost({ post: next, includeUrl: false }).length > TELEGRAM_PHOTO_CAPTION_TARGET) {
    const listIndex = next.bodyBlocks.findIndex((block) => block.type === 'list' && block.items.length > 1);
    if (listIndex >= 0) {
      next = {
        ...next,
        bodyBlocks: next.bodyBlocks.map((block, index) => (index === listIndex && block.type === 'list' ? shortenListBlock(block) : block)),
      };
      continue;
    }

    const longestBlockIndex = next.bodyBlocks.reduce((bestIndex, block, index, blocks) => {
      if (bestIndex < 0) return index;
      return blockTextLength(block) > blockTextLength(blocks[bestIndex]) ? index : bestIndex;
    }, -1);

    if (longestBlockIndex >= 0 && blockTextLength(next.bodyBlocks[longestBlockIndex]) > 70) {
      next = {
        ...next,
        bodyBlocks: next.bodyBlocks.map((block, index) => (index === longestBlockIndex ? shortenBodyBlock(block) : block)),
      };
      continue;
    }

    if (next.cta && next.cta.text.length > 60) {
      next = {
        ...next,
        cta: { text: shortenText(next.cta.text, next.cta.text.length - 20) },
      };
      continue;
    }

    if (next.bodyBlocks.length > 2) {
      next = {
        ...next,
        bodyBlocks: next.bodyBlocks.slice(0, -1),
      };
      continue;
    }

    break;
  }

  return next;
}

function renderListBlock(block: ListBlock) {
  return block.items.map((item) => `• ${renderInlineText(item)}`).join('\n');
}

function renderBodyBlock(block: PostBodyBlock) {
  if (block.type === 'list') {
    return renderListBlock(block);
  }

  if (block.type === 'storyBeat') {
    return `<i>${renderInlineText(block.text)}</i>`;
  }

  if (block.type === 'punchline') {
    return `<b>${renderInlineText(block.text)}</b>`;
  }

  if (block.type === 'takeaway') {
    return `💡 ${renderInlineText(block.text)}`;
  }

  return renderInlineText(block.text);
}

function renderQuestionBlock(question: string) {
  return `<i>${renderInlineText(question)}</i>`;
}

function renderCta(text: string) {
  return text.trim().endsWith('?') ? renderQuestionBlock(text) : renderInlineText(text);
}

export function renderTelegramPost(args: {
  post: StructuredTelegramPost;
  includeUrl: boolean;
  url?: string;
}) {
  const parts = [`${escapeHtml(args.post.titleEmoji)} <b>${renderInlineText(args.post.title)}</b>`];

  parts.push(...args.post.bodyBlocks.map((block) => renderBodyBlock(block)));

  if (args.post.cta?.text) {
    parts.push(renderCta(args.post.cta.text));
  }

  if (args.includeUrl && args.url) {
    parts.push(escapeHtml(args.url));
  }

  return parts.join('\n\n').trim();
}

export function renderTelegramCaption(args: { post: StructuredTelegramPost }) {
  const compacted = compactPost(args.post);
  return renderTelegramPost({ post: compacted, includeUrl: false });
}

export function renderTelegramMessage(args: { post: StructuredTelegramPost; url: string }) {
  let message = renderTelegramPost({ post: args.post, includeUrl: true, url: args.url });

  if (message.length <= TELEGRAM_MESSAGE_TARGET) {
    return message;
  }

  const compacted = compactPost(args.post);
  message = renderTelegramPost({ post: compacted, includeUrl: true, url: args.url });

  return message.length <= TELEGRAM_MESSAGE_TARGET
    ? message
    : `${shortenText(message, TELEGRAM_MESSAGE_TARGET - 1)}…`;
}

export function canSendAsPhotoCaption(text: string) {
  return text.trim().length <= TELEGRAM_PHOTO_CAPTION_MAX;
}

export function buildFallbackStructuredPost(args: {
  xUsername?: string | null;
  text: string;
  sourceTweetId?: string;
  configVersion?: string;
}): StructuredTelegramPost {
  const username = args.xUsername ?? 'unknown';
  const cleanedText = args.text.replace(/\s+/g, ' ').trim();

  return {
    archetype: 'plain-punchline',
    titleEmoji: '🧠',
    title: `Что нового у @${username}`,
    bodyBlocks: [
      {
        type: 'paragraph',
        text: shortenText(cleanedText, 280),
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
    sourceTweetId: args.sourceTweetId ?? 'unknown',
    configVersion: args.configVersion ?? 'fallback-v1',
  };
}
