import 'dotenv/config';
import { Bot, InputFile } from 'grammy';
import { mustEnv } from './env.js';
import { generateTelegramPost, openRouterEnabled } from './openrouter-text.js';
import { generateTelegramPostImage, openRouterImageEnabled } from './openrouter-image.js';
import { ack, autoClaimPending, closeRedis, ensureGroup, readOneNew } from './redis.js';

const MENTION = '@assistant_open_claw_bot';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return String(e);
}

function formatMessage(args: { xUsername?: string | null; url: string; text: string }) {
  const header = `${MENTION} новый твит от @${args.xUsername ?? 'unknown'}`;
  return `${header}\n${args.url}\n\n${args.text}`.trim();
}

async function main() {
  const bot = new Bot(mustEnv('TELEGRAM_BOT_TOKEN'));
  const chatId = Number(mustEnv('TELEGRAM_CHAT_ID'));

  // Fixed: one message every 30 seconds
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
    // Drain the queue until it becomes empty.
    while (true) {
      // First: try to recover pending messages (if previous run crashed before XACK)
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

      let msg = formatMessage({
        xUsername: payload.xUsername,
        url: payload.url,
        text: payload.text,
      });

      if (openRouterEnabled()) {
        try {
          msg = await generateTelegramPost({
            xUsername: payload.xUsername,
            url: payload.url,
            text: payload.text,
          });
        } catch (e) {
          console.warn('openrouter generate failed, using fallback message', errorMessage(e));
        }
      }

      if (openRouterImageEnabled()) {
        try {
          const image = await generateTelegramPostImage({ telegramPostText: msg });

          await bot.api.sendPhoto(chatId, new InputFile(image, 'post.png'), {
            caption: msg,
            parse_mode: 'Markdown',
          });
        } catch (e) {
          console.warn('openrouter image generate failed, posting without image', errorMessage(e));

          await bot.api.sendMessage(chatId, msg, {
            parse_mode: 'Markdown',
            link_preview_options: { is_disabled: true },
          });
        }
      } else {
        await bot.api.sendMessage(chatId, msg, {
          parse_mode: 'Markdown',
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
