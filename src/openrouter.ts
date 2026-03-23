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

  // NOTE: Prompt will be refined later with Kostya.
  const system =
    'You are an assistant that rewrites tweets into detailed Telegram posts in Russian. ' +
    'Keep the meaning accurate, remove fluff, and keep it readable. Do not add hashtags. ' +
    'Always include the source link at the end.';

  const user = [
    `Tweet author: @${args.xUsername ?? 'unknown'}`,
    `Source URL: ${args.url}`,
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
