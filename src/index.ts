import 'dotenv/config';
import { Bot, InputFile } from 'grammy';
import { mustEnv } from './env.js';
import { generateStructuredTelegramPost, openRouterEnabled } from './openrouter-text.js';
import { generateTelegramPostImage, openRouterImageEnabled } from './openrouter-image.js';
import {
  buildFallbackStructuredPost,
  canSendAsPhotoCaption,
  renderTelegramCaption,
  renderTelegramMessage,
} from './telegram-render.js';
import { ack, autoClaimPending, closeRedis, ensureGroup, readOneNew } from './redis.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return String(e);
}

async function main() {
  const bot = new Bot(mustEnv('TELEGRAM_BOT_TOKEN'));
  const chatId = Number(mustEnv('TELEGRAM_CHAT_ID'));

  const delayMs = 30 * 1000;

  console.log('forwarder start', {
    chatId,
    delaySeconds: delayMs / 1000,
    openRouterTextEnabled: openRouterEnabled(),
    openRouterTextModel: (process.env.OPENROUTER_TEXT_MODEL ?? '').trim() || null,
    openRouterImageEnabled: openRouterImageEnabled(),
    openRouterImageModel: (process.env.OPENROUTER_IMAGE_MODEL ?? '').trim() || null,
  });

  await ensureGroup();
  console.log('redis consumer group ensured');

  let sent = 0;
  let seen = 0;

  const consumer = 'voyager-forwarder-1';

  try {
    while (true) {
      const reclaimed = await autoClaimPending({ consumer, minIdleMs: 60_000, count: 1 });
      const item = reclaimed.length ? reclaimed[0] : await readOneNew(consumer, 1500);

      if (!item) {
        console.log('queue empty, exiting', { sent, seen });
        break;
      }

      seen += 1;

      if (reclaimed.length) {
        console.log('recovered pending message', { id: item.id });
      }

      const payload = item.payload;
      if (!payload?.url) {
        console.warn('skip malformed stream entry', { id: item.id });
        await ack(item.id);
        continue;
      }

      console.log('sending', {
        id: item.id,
        tweetId: payload.tweetId,
        xUsername: payload.xUsername,
        url: payload.url,
      });

      let post = buildFallbackStructuredPost({
        xUsername: payload.xUsername,
        text: payload.text,
      });

      if (openRouterEnabled()) {
        try {
          post = await generateStructuredTelegramPost({
            xUsername: payload.xUsername,
            url: payload.url,
            text: payload.text,
          });
        } catch (e) {
          console.warn('openrouter generate failed, using fallback structured post', errorMessage(e));
        }
      }

      const caption = renderTelegramCaption({ post });
      const message = renderTelegramMessage({ post, url: payload.url });

      if (openRouterImageEnabled() && canSendAsPhotoCaption(caption)) {
        try {
          const image = await generateTelegramPostImage({ post });

          await bot.api.sendPhoto(chatId, new InputFile(image, 'post.png'), {
            caption,
            parse_mode: 'HTML',
          });
        } catch (e) {
          console.warn('openrouter image generate failed, posting without image', errorMessage(e));

          await bot.api.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
          });
        }
      } else {
        if (openRouterImageEnabled() && !canSendAsPhotoCaption(caption)) {
          console.log('skip image: caption too long', {
            captionLength: caption.trim().length,
          });
        }

        await bot.api.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      }

      await ack(item.id);
      sent += 1;

      console.log('sent+acked', { id: item.id, sent });

      await sleep(delayMs);
    }
  } finally {
    await closeRedis();
  }

  console.log(JSON.stringify({ ok: true, sent }, null, 2));
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exitCode = 1;
});
