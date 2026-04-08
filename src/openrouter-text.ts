import { OpenRouter } from '@openrouter/sdk';
import { logger, serializeError } from './logger.js';
import { parseStructuredTelegramPost, type StructuredTelegramPost } from './post-contract.js';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

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

function buildSystemPrompt() {
  return `Ты — редактор Telegram‑канала про фронтенд‑разработку. Преврати твит другого автора в структурированный JSON для Telegram‑поста.

Требования:
- Язык: русский, разговорный тон, без канцелярита
- Не используй Markdown, HTML или любую другую разметку внутри значений
- Все строковые поля должны быть plain text only
- Если в тексте есть упоминание вида @username, оставляй его как plain text '@username', не разворачивай в URL и не меняй имя
- Заголовок должен быть коротким, цепляющим и начинаться с заглавной буквы
- titleEmoji обязателен: ровно один подходящий эмодзи для заголовка
- lead: 1 короткий абзац, раскрывающий тезис твита
- bullets: необязательный массив из 0-5 коротких пунктов
- takeaway: 1-2 короткие фразы в живом устном тоне, как личная позиция автора канала для своих во фронтенд-комьюнити
- takeaway должен не просто пересказывать твит, а давать авторский тезис и практический вывод
- takeaway может мягко спорить с тезисом твита, если это делает вывод честнее и полезнее
- takeaway по умолчанию приземляй на реальность небольших и средних продуктовых команд: скорость, поддержка, компромиссы, цена решения
- если твит банальный, переоценённый или слишком хайповый, takeaway может прямо это назвать, но без токсичности и снобизма
- takeaway должен звучать уверенно, немного колко, по-человечески, а не редакторски стерильно
- question: один короткий вопрос в конце, заканчивается вопросительным знаком
- imageBrief.concept: краткая визуальная идея для иллюстрации
- imageBrief.style: краткое описание визуального стиля
- Не добавляй выдуманные факты
- Сохраняй смысл твита
- Пытайся уложить полезный контент примерно в 850 символов
- Верни только JSON, без пояснений и без code fences

Строгая JSON-схема ответа:
{
  "titleEmoji": "🧠",
  "title": "...",
  "lead": "...",
  "bullets": ["..."],
  "takeaway": "...",
  "question": "...",
  "imageBrief": {
    "concept": "...",
    "style": "..."
  }
}`;
}

function buildUserPrompt(args: { xUsername: string | null; url: string; text: string }) {
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

export async function generateStructuredTelegramPost(args: {
  xUsername: string | null;
  url: string;
  text: string;
}): Promise<StructuredTelegramPost> {
  const apiKey = env('OPENROUTER_API_KEY');
  const model = env('OPENROUTER_TEXT_MODEL');
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  if (!model) throw new Error('OPENROUTER_TEXT_MODEL is required');

  const system = buildSystemPrompt();
  const user = buildUserPrompt(args);
  const logContext = {
    xUsername: args.xUsername,
    url: args.url,
  };

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
    return firstParsed.value;
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
    return secondParsed.value;
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
