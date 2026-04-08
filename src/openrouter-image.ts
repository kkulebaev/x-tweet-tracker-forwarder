import { OpenRouter } from '@openrouter/sdk';
import { logger } from './logger.js';
import type { PostBodyBlock, StructuredTelegramPost } from './post-contract.js';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function env(key: string) {
  return (process.env[key] ?? '').trim();
}

let client: OpenRouter | null = null;

function openRouter() {
  if (!client) {
    client = new OpenRouter({ apiKey: env('OPENROUTER_API_KEY') });
  }
  return client;
}

export function openRouterImageEnabled() {
  return Boolean(env('OPENROUTER_API_KEY') && env('OPENROUTER_IMAGE_MODEL'));
}

function describeBlock(block: PostBodyBlock) {
  if (block.type === 'list') {
    return `list: ${block.items.join('; ')}`;
  }

  return `${block.type}: ${block.text}`;
}

function buildImagePrompt(args: { post: StructuredTelegramPost }) {
  const OPENROUTER_IMAGE_PROMPT_SYSTEM = `You are an expert editorial illustrator for Telegram posts.
Generate a single, high-quality image that matches the provided structured brief.

Hard constraint:
- Do NOT introduce any new entities, facts, locations, people, brands, numbers, or claims that are not explicitly present in the brief.
- You may use only generic visual metaphors that do not add factual content.

No text overlays, no captions, no watermarks, no logos.
Avoid photorealistic faces; prefer stylized illustration or abstract concept art.`;

  const OPENROUTER_IMAGE_SIZE = '1024x1024';
  const summarizedBlocks = args.post.bodyBlocks.map((block) => describeBlock(block)).join('\n');

  const user = [
    `POST ARCHETYPE: ${args.post.archetype}`,
    `POST TITLE: ${args.post.title}`,
    'POST BODY BLOCKS:',
    summarizedBlocks,
    `POST CTA: ${args.post.cta?.text ?? 'none'}`,
    `IMAGE CONCEPT: ${args.post.imageBrief.concept}`,
    `IMAGE STYLE: ${args.post.imageBrief.style}`,
    '',
    'TASK:',
    'Generate ONE image that visually represents this structured brief.',
    '',
    'REQUIREMENTS:',
    `- 1 image, square ${OPENROUTER_IMAGE_SIZE}.`,
    '- Stay grounded in the brief only.',
    '- Mood: modern, clean, slightly dramatic, high contrast.',
    '- No readable text anywhere in the image.',
    '- No brand logos or trademarks.',
    '- If people are implied: depict as silhouettes or stylized figures only.',
    '- Prefer editorial illustration / abstract concept art over literal screenshots.',
    '',
    'OUTPUT:',
    'Return only the final image. If you output any text, the result is invalid.',
  ].join('\n');

  return {
    system: OPENROUTER_IMAGE_PROMPT_SYSTEM,
    user,
    size: OPENROUTER_IMAGE_SIZE,
  };
}

function getBase64FromDataUrl(dataUrl: string) {
  const idx = dataUrl.indexOf(',');
  if (idx < 0) return null;
  return dataUrl.slice(idx + 1).trim();
}

function bodyBlocksTextLength(post: StructuredTelegramPost) {
  return post.bodyBlocks.reduce((sum, block) => {
    if (block.type === 'list') {
      return sum + block.items.join(' ').length;
    }

    return sum + block.text.length;
  }, 0);
}

export async function generateTelegramPostImage(args: { post: StructuredTelegramPost }) {
  const apiKey = env('OPENROUTER_API_KEY');
  const model = env('OPENROUTER_IMAGE_MODEL');
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  if (!model) throw new Error('OPENROUTER_IMAGE_MODEL is required');

  const prompt = buildImagePrompt({ post: args.post });
  const start = Date.now();

  logger.info('openrouter_image_request_started', {
    model,
    archetype: args.post.archetype,
    titleLength: args.post.title.length,
    bodyBlocksCount: args.post.bodyBlocks.length,
    bodyTextLength: bodyBlocksTextLength(args.post),
    conceptLength: args.post.imageBrief.concept.length,
    styleLength: args.post.imageBrief.style.length,
  });

  const res = await openRouter().chat.send({
    chatGenerationParams: {
      model,
      messages: [
        { role: 'system', content: prompt.system } satisfies ChatMessage,
        { role: 'user', content: prompt.user } satisfies ChatMessage,
      ],
      temperature: 0.7,
      stream: false,
      modalities: ['image'],
      imageConfig: {
        size: prompt.size,
      },
    },
  });

  const ms = Date.now() - start;

  const image = res.choices?.[0]?.message?.images?.[0];
  const dataUrl = image?.imageUrl?.url;
  if (!dataUrl || typeof dataUrl !== 'string') {
    logger.warn('openrouter_image_response_invalid', {
      model,
      durationMs: ms,
    });
    throw new Error('OpenRouter response missing choices[0].message.images[0].image_url.url');
  }

  const b64 = getBase64FromDataUrl(dataUrl);
  if (!b64) {
    logger.warn('openrouter_image_data_url_invalid', {
      model,
      durationMs: ms,
    });
    throw new Error('OpenRouter image url is not a data URL');
  }

  const buf = Buffer.from(b64, 'base64');

  logger.info('openrouter_image_request_succeeded', {
    model,
    durationMs: ms,
    bytes: buf.byteLength,
  });

  return buf;
}
