import { OpenRouter } from '@openrouter/sdk';

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

function buildImagePrompt(args: { telegramPostText: string }) {
  // Per request: keep these in code, not in env.
  const OPENROUTER_IMAGE_PROMPT_SYSTEM = `You are an expert editorial illustrator for Telegram posts.
Generate a single, high-quality image that matches the provided post text.

Hard constraint:
- Do NOT introduce any new entities, facts, locations, people, brands, numbers, or claims that are not explicitly present in the post text.
- You may use only generic visual metaphors (light, abstract shapes, mood, composition) that do not add factual content.

No text overlays, no captions, no watermarks, no logos.
Avoid photorealistic faces; prefer stylized illustration or abstract concept art.`;

  const OPENROUTER_IMAGE_SIZE = '1024x1024';

  const user = `POST TEXT (Russian):\n${args.telegramPostText}\n\nTASK:\nGenerate ONE image that visually represents the post text.\n\nREQUIREMENTS:\n- 1 image, square ${OPENROUTER_IMAGE_SIZE}.\n- The image must be grounded strictly in the post text. Do not add specific objects/actors unless they are explicitly mentioned.\n- Mood: modern, clean, slightly dramatic, high contrast.\n- Style: digital illustration / editorial art, sharp shapes, subtle gradients.\n- No readable text anywhere in the image (no UI labels, signs, letters, numbers).\n- No brand logos or trademarks.\n- If people are mentioned: depict as silhouettes or stylized figures only (no identifiable real persons).\n- If the post is about software/AI/tech: show only abstract or generic metaphors (streams, nodes, signals) unless specific items are named in the post.\n\nVALIDATION (must follow):\nIf you are about to add any concrete object/detail not explicitly present in the post text, replace it with an abstract shape/metaphor.\n\nOUTPUT:\nReturn only the final image. If you output any text, the result is invalid.`;

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

export async function generateTelegramPostImage(args: { telegramPostText: string }) {
  const apiKey = env('OPENROUTER_API_KEY');
  const model = env('OPENROUTER_IMAGE_MODEL');
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  if (!model) throw new Error('OPENROUTER_IMAGE_MODEL is required');

  const prompt = buildImagePrompt({ telegramPostText: args.telegramPostText });

  const start = Date.now();

  // OpenRouter SDK uses OpenAI-compatible params inside chatGenerationParams.
  const res = await openRouter().chat.send({
    chatGenerationParams: {
      model,
      messages: [
        { role: 'system', content: prompt.system } satisfies ChatMessage,
        { role: 'user', content: prompt.user } satisfies ChatMessage,
      ],
      temperature: 0.7,
      stream: false,
      // OpenAI-compatible multimodal output.
      modalities: ['image'],
      // Provider-specific image configuration.
      imageConfig: {
        size: prompt.size,
      },
    },
  });

  const ms = Date.now() - start;

  const image = res.choices?.[0]?.message?.images?.[0];
  const dataUrl = image?.imageUrl?.url;
  if (!dataUrl || typeof dataUrl !== 'string') {
    console.warn('openrouter image bad response', { ms, model });
    throw new Error('OpenRouter response missing choices[0].message.images[0].image_url.url');
  }

  const b64 = getBase64FromDataUrl(dataUrl);
  if (!b64) {
    throw new Error('OpenRouter image url is not a data URL');
  }

  const buf = Buffer.from(b64, 'base64');

  console.log('openrouter image ok', { ms, model, bytes: buf.byteLength });

  return buf;
}
