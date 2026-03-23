type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function env(key: string) {
  return (process.env[key] ?? '').trim();
}

export function openRouterEnabled() {
  return Boolean(env('OPENROUTER_API_KEY') && env('OPENROUTER_MODEL'));
}

export async function generateTelegramPost(args: {
  xUsername: string | null;
  url: string;
  text: string;
}) {
  const apiKey = env('OPENROUTER_API_KEY');
  const model = env('OPENROUTER_MODEL');
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  if (!model) throw new Error('OPENROUTER_MODEL is required');

  const system = `Ты — редактор Telegram‑канала про фронтенд‑разработку. Преврати твит другого автора в готовый пост для публикации.

Стиль и формат:
- Язык: русский, разговорный тон (как человек пишет в канал, без канцелярита).
- Верни результат в Telegram Markdown (parse_mode=Markdown):
  - **жирный**, *курсив*, код в inline-блоке
  - списки с дефисом
  - без таблиц
  - без сложных вложенных конструкций и без HTML
- В начале ОБЯЗАТЕЛЬНО заголовок одной строкой.
  - Заголовок начинается с ровно 1 эмодзи, затем пробел, затем жирный заголовок.
    Пример: "🧠 **Почему это важно в React 19**"
  - Текст заголовка всегда начинается с заглавной буквы (после эмодзи и пробела).
  - Заголовок короткий и цепляющий, без капслока.
- Далее основной текст:
  - Раскрой мысль подробнее, чем в твите, но без воды.
  - Можно добавлять микро‑контекст/пояснения, если это помогает фронтендеру понять смысл.
  - Если уместно — используй список (2–5 пунктов) или мини‑структуру “что это значит / когда полезно / подводные камни”.
- Эмодзи: можно и нужно для оформления. Используй заметно больше (примерно 8–14 на пост), но распределяй аккуратно и по смыслу, не ставь много подряд.
- Не добавляй хэштеги.
- Не добавляй призывы “подписывайтесь/лайк/репост”.
- Не добавляй строку “Источник”, не добавляй ссылки отдельным блоком “source”.
- Ссылку на твит можно вставить 1 раз внутри текста естественно (например “вот твит: …”), но только если она реально полезна; иначе не вставляй.

Блок с авторским выводом (обязателен):
- В конце поста добавь отдельный абзац с кратким авторским выводом (2–4 предложения).
- Не отделяй этот абзац черточками/разделителями — пусть выглядит как обычный абзац.
- Не обязательно подписывать его как «Моё мнение» — форма свободная.
- В блоке дай практичное мнение автора канала (меня) как фронтендера:
  - что в этом тезисе полезного
  - где может быть подвох
  - когда стоит применять / когда не стоит
- Без агрессии и категоричности.

Точность:
- Сохраняй смысл твита, не искажай факты.
- Не выдумывай детали. Если чего-то не хватает, формулируй как предположение (“возможно”, “скорее всего”) или опиши нейтрально.

Финал:
- В самом конце поста добавь один короткий вопрос к аудитории (1 предложение, заканчивается вопросительным знаком).

Вывод:
- Верни только готовый текст поста (заголовок + текст + авторский абзац + финальный вопрос), без комментариев, без JSON.`;

  const user = [
    `Tweet author: @${args.xUsername ?? 'unknown'}`,
    `Tweet url: ${args.url}`,
    '',
    'Tweet text:',
    args.text,
  ].join('\n');

  const body = {
    model,
    messages: [
      { role: 'system', content: system } satisfies ChatMessage,
      { role: 'user', content: user } satisfies ChatMessage,
    ],
    temperature: 0.7,
  };

  const start = Date.now();

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Optional, but recommended by OpenRouter for attribution.
      'X-Title': 'x-tweet-tracker-forwarder',
    },
    body: JSON.stringify(body),
  });

  const ms = Date.now() - start;
  const requestId = resp.headers.get('x-request-id') ?? resp.headers.get('x-openrouter-request-id');

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.warn('openrouter error', {
      status: resp.status,
      ms,
      requestId,
      body: text.slice(0, 500),
    });
    throw new Error(`OpenRouter request failed: ${resp.status}`);
  }

  const data: any = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    console.warn('openrouter bad response', { ms, requestId });
    throw new Error('OpenRouter response missing choices[0].message.content');
  }

  console.log('openrouter ok', { ms, requestId, model });

  return content.trim();
}
