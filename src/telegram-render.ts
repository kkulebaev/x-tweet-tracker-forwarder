import type { StructuredTelegramPost } from './post-contract.js';

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

function compactPost(post: StructuredTelegramPost): StructuredTelegramPost {
  let next = { ...post, bullets: [...post.bullets] };

  while (renderTelegramPost({ post: next, includeUrl: false }).length > TELEGRAM_PHOTO_CAPTION_TARGET) {
    if (next.bullets.length > 0) {
      next = { ...next, bullets: next.bullets.slice(0, -1) };
      continue;
    }

    if (next.lead.length > 220) {
      next = { ...next, lead: shortenText(next.lead, next.lead.length - 60) };
      continue;
    }

    if (next.takeaway.length > 180) {
      next = { ...next, takeaway: shortenText(next.takeaway, next.takeaway.length - 50) };
      continue;
    }

    if (next.question.length > 80) {
      next = { ...next, question: shortenText(next.question, next.question.length - 20) };
      continue;
    }

    break;
  }

  return next;
}

function renderBullets(bullets: string[]) {
  if (bullets.length === 0) return '';

  return bullets.map((item) => `• ${renderInlineText(item)}`).join('\n');
}

function renderQuestionBlock(question: string) {
  return `<i>${renderInlineText(question)}</i>`;
}

export function renderTelegramPost(args: {
  post: StructuredTelegramPost;
  includeUrl: boolean;
  url?: string;
}) {
  const parts = [
    `${escapeHtml(args.post.titleEmoji)} <b>${renderInlineText(args.post.title)}</b>`,
    renderInlineText(args.post.lead),
  ];

  const bulletsBlock = renderBullets(args.post.bullets);
  if (bulletsBlock) {
    parts.push(bulletsBlock);
  }

  parts.push(renderInlineText(args.post.takeaway));
  parts.push(renderQuestionBlock(args.post.question));

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
}): StructuredTelegramPost {
  const username = args.xUsername ?? 'unknown';
  const cleanedText = args.text.replace(/\s+/g, ' ').trim();
  const lead = shortenText(cleanedText, 280);

  return {
    titleEmoji: '🧠',
    title: `Что нового у @${username}`,
    lead,
    bullets: [],
    takeaway: 'Здесь лучше смотреть на сам тезис и проверять, как он ложится на реальную фронтенд-практику.',
    question: 'Что думаешь об этом подходе?',
    imageBrief: {
      concept: 'editorial illustration about a frontend development idea from a tweet',
      style: 'modern clean digital editorial illustration with subtle drama',
    },
  };
}
