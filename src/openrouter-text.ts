import { OpenRouter } from '@openrouter/sdk';
import { selectRandomArchetype } from './archetype-selector.js';
import { logger, serializeError } from './logger.js';
import { parseStructuredTelegramPost, type StructuredTelegramPost } from './post-contract.js';
import { rewriteConfig, type ArchetypeId, type RewriteArchetype } from './rewrite-config.js';
import { buildSystemPrompt } from './system-prompt.js';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type StructuredGenerationArgs = {
  xUsername: string | null;
  url: string;
  text: string;
};

export type StructuredGenerationResult = {
  post: StructuredTelegramPost;
  archetypeId: ArchetypeId;
  configVersion: string;
};

function env(key: string) {
  return (process.env[key] ?? '').trim();
}

export function openRouterEnabled() {
  return Boolean(env('OPENROUTER_API_KEY') && env('OPENROUTER_TEXT_MODEL'));
}

let client: OpenRouter | null = null;

function openRouter() {
  if (!client) {
    client = new OpenRouter({
      apiKey: env('OPENROUTER_API_KEY'),
    });
  }
  return client;
}

function buildUserPrompt(args: StructuredGenerationArgs) {
  return [
    `Tweet author: @${args.xUsername ?? 'unknown'}`,
    `Tweet url: ${args.url}`,
    '',
    'Tweet text:',
    args.text,
  ].join('\n');
}

async function requestPostJson(args: {
  messages: ChatMessage[];
  model: string;
  attempt: number;
  logContext: Record<string, unknown>;
}) {
  const start = Date.now();

  logger.info('openrouter_text_request_started', {
    ...args.logContext,
    model: args.model,
    attempt: args.attempt,
  });

  const res = await openRouter().chat.send({
    chatGenerationParams: {
      model: args.model,
      messages: args.messages,
      temperature: 0.7,
      stream: false,
    },
  });

  const ms = Date.now() - start;

  const content = res.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    logger.warn('openrouter_text_response_invalid', {
      ...args.logContext,
      model: args.model,
      attempt: args.attempt,
      durationMs: ms,
    });
    throw new Error('OpenRouter response missing choices[0].message.content');
  }

  logger.info('openrouter_text_request_succeeded', {
    ...args.logContext,
    model: args.model,
    attempt: args.attempt,
    durationMs: ms,
    contentLength: content.length,
  });

  return content.trim();
}

function buildLogContext(args: StructuredGenerationArgs, archetype: RewriteArchetype) {
  return {
    xUsername: args.xUsername,
    url: args.url,
    archetypeId: archetype.id,
    archetypeLengthBand: archetype.lengthBand,
    configVersion: rewriteConfig.configVersion,
  };
}

async function generateStructuredTelegramPostWithArchetype(args: {
  input: StructuredGenerationArgs;
  archetype: RewriteArchetype;
}): Promise<StructuredGenerationResult> {
  const apiKey = env('OPENROUTER_API_KEY');
  const model = env('OPENROUTER_TEXT_MODEL');
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  if (!model) throw new Error('OPENROUTER_TEXT_MODEL is required');

  const system = buildSystemPrompt({
    config: rewriteConfig,
    archetype: args.archetype,
  });
  const user = buildUserPrompt(args.input);
  const logContext = buildLogContext(args.input, args.archetype);

  const firstAttempt = await requestPostJson({
    messages: [
      { role: 'system', content: system } satisfies ChatMessage,
      { role: 'user', content: user } satisfies ChatMessage,
    ],
    model,
    attempt: 1,
    logContext,
  });

  const firstParsed = parseStructuredTelegramPost(firstAttempt);
  if (firstParsed.ok) {
    logger.info('structured_post_validation_succeeded', {
      ...logContext,
      attempt: 1,
      bulletsCount: firstParsed.value.bullets.length,
    });
    return {
      post: firstParsed.value,
      archetypeId: args.archetype.id,
      configVersion: rewriteConfig.configVersion,
    };
  }

  logger.warn('structured_post_validation_failed', {
    ...logContext,
    attempt: 1,
    errors: firstParsed.errors,
  });

  const retryPrompt = [
    'Ты вернул невалидный JSON. Исправь ответ и верни только валидный JSON без пояснений.',
    `Ошибки валидации: ${firstParsed.errors.join('; ')}`,
  ].join('\n');

  const secondAttempt = await requestPostJson({
    messages: [
      { role: 'system', content: system } satisfies ChatMessage,
      { role: 'user', content: user } satisfies ChatMessage,
      { role: 'assistant', content: firstAttempt } satisfies ChatMessage,
      { role: 'user', content: retryPrompt } satisfies ChatMessage,
    ],
    model,
    attempt: 2,
    logContext,
  });

  const secondParsed = parseStructuredTelegramPost(secondAttempt);
  if (secondParsed.ok) {
    logger.info('structured_post_validation_succeeded', {
      ...logContext,
      attempt: 2,
      bulletsCount: secondParsed.value.bullets.length,
    });
    return {
      post: secondParsed.value,
      archetypeId: args.archetype.id,
      configVersion: rewriteConfig.configVersion,
    };
  }

  logger.error('structured_post_validation_failed', {
    ...logContext,
    attempt: 2,
    errors: secondParsed.errors,
  });

  const error = new Error(`OpenRouter returned invalid structured post: ${secondParsed.errors.join('; ')}`);
  logger.error('structured_post_generation_failed', {
    ...logContext,
    error: serializeError(error),
  });
  throw error;
}

export async function generateStructuredTelegramPostForArchetype(args: StructuredGenerationArgs & { archetypeId: ArchetypeId }) {
  const archetype = rewriteConfig.archetypes.find((candidate) => candidate.id === args.archetypeId);
  if (!archetype) {
    throw new Error(`Unknown rewrite archetype: ${args.archetypeId}`);
  }

  return generateStructuredTelegramPostWithArchetype({
    input: {
      xUsername: args.xUsername,
      url: args.url,
      text: args.text,
    },
    archetype,
  });
}

export async function generateStructuredTelegramPost(args: StructuredGenerationArgs): Promise<StructuredGenerationResult> {
  const archetype = selectRandomArchetype(rewriteConfig.archetypes);
  return generateStructuredTelegramPostWithArchetype({
    input: args,
    archetype,
  });
}
