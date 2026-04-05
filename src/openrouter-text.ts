import { OpenRouter } from '@openrouter/sdk';
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
- Заголовок должен быть коротким, цепляющим и начинаться с заглавной буквы
- titleEmoji обязателен: ровно один подходящий эмодзи для заголовка
- lead: 1 короткий абзац, раскрывающий тезис твита
- bullets: необязательный массив из 0-5 коротких пунктов
- takeaway: короткий авторский вывод с практическим мнением фронтендера
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

async function requestPostJson(messages: ChatMessage[], model: string) {
  const start = Date.now();

  const res = await openRouter().chat.send({
    chatGenerationParams: {
      model,
      messages,
      temperature: 0.7,
      stream: false,
    },
  });

  const ms = Date.now() - start;

  const content = res.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    console.warn('openrouter bad response', { ms, model });
    throw new Error('OpenRouter response missing choices[0].message.content');
  }

  console.log('openrouter ok', { ms, model });

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

  const firstAttempt = await requestPostJson(
    [
      { role: 'system', content: system } satisfies ChatMessage,
      { role: 'user', content: user } satisfies ChatMessage,
    ],
    model,
  );

  const firstParsed = parseStructuredTelegramPost(firstAttempt);
  if (firstParsed.ok) {
    return firstParsed.value;
  }

  console.warn('openrouter invalid structured post, retrying', {
    model,
    errors: firstParsed.errors,
  });

  const retryPrompt = [
    'Ты вернул невалидный JSON. Исправь ответ и верни только валидный JSON без пояснений.',
    `Ошибки валидации: ${firstParsed.errors.join('; ')}`,
  ].join('\n');

  const secondAttempt = await requestPostJson(
    [
      { role: 'system', content: system } satisfies ChatMessage,
      { role: 'user', content: user } satisfies ChatMessage,
      { role: 'assistant', content: firstAttempt } satisfies ChatMessage,
      { role: 'user', content: retryPrompt } satisfies ChatMessage,
    ],
    model,
  );

  const secondParsed = parseStructuredTelegramPost(secondAttempt);
  if (secondParsed.ok) {
    return secondParsed.value;
  }

  throw new Error(`OpenRouter returned invalid structured post: ${secondParsed.errors.join('; ')}`);
}
