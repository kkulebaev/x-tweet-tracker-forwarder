import 'dotenv/config';
import { Bot, InputFile } from 'grammy';
import { mustEnv } from './env.js';
import { logger, serializeError } from './logger.js';
import { generateStructuredTelegramPost, openRouterEnabled } from './openrouter-text.js';
import { generateTelegramPostImage, openRouterImageEnabled } from './openrouter-image.js';
import { canSendAsPhotoCaption, renderTelegramCaption, renderTelegramMessage } from './telegram-render.js';
import { ack, autoClaimPending, closeRedis, ensureGroup, readOneNew } from './redis.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const bot = new Bot(mustEnv('TELEGRAM_BOT_TOKEN'));
  const chatId = Number(mustEnv('TELEGRAM_CHAT_ID'));

  const delayMs = 30 * 1000;

  logger.info('forwarder_started', {
    chatId,
    delaySeconds: delayMs / 1000,
    openRouterTextEnabled: openRouterEnabled(),
    openRouterTextModel: (process.env.OPENROUTER_TEXT_MODEL ?? '').trim() || null,
    openRouterImageEnabled: openRouterImageEnabled(),
    openRouterImageModel: (process.env.OPENROUTER_IMAGE_MODEL ?? '').trim() || null,
  });

  await ensureGroup();
  logger.info('redis_group_ready');

  let sent = 0;
  let seen = 0;

  const consumer = 'voyager-forwarder-1';

  try {
    while (true) {
      const reclaimed = await autoClaimPending({ consumer, minIdleMs: 60_000, count: 1 });
      const item = reclaimed.length ? reclaimed[0] : await readOneNew(consumer, 1500);

      if (!item) {
        logger.info('queue_empty', { sent, seen });
        break;
      }

      seen += 1;

      if (reclaimed.length) {
        logger.info('stream_item_reclaimed', { streamId: item.id });
      }

      const payload = item.payload;
      if (!payload?.url) {
        logger.warn('stream_item_malformed', { streamId: item.id });
        await ack(item.id);
        logger.info('stream_item_acked', { streamId: item.id, reason: 'malformed' });
        continue;
      }

      const logContext = {
        streamId: item.id,
        tweetId: payload.tweetId,
        xUsername: payload.xUsername,
        url: payload.url,
      };

      logger.info('stream_item_received', logContext);

      if (!openRouterEnabled()) {
        throw new Error('OPENROUTER text generation must be enabled');
      }

      logger.info('structured_post_generation_started', logContext);
      const generated = await generateStructuredTelegramPost({
        xUsername: payload.xUsername,
        url: payload.url,
        text: payload.text,
      });
      const post = generated.post;
      logger.info('structured_post_generation_succeeded', {
        ...logContext,
        archetypeId: generated.archetypeId,
        configVersion: generated.configVersion,
        bulletsCount: post.bullets.length,
        titleLength: post.title.length,
        leadLength: post.lead.length,
        takeawayLength: post.takeaway.length,
        questionLength: post.question.length,
      });

      const caption = renderTelegramCaption({ post });
      const message = renderTelegramMessage({ post, url: payload.url });
      const usePhoto = openRouterImageEnabled() && canSendAsPhotoCaption(caption);

      logger.info('telegram_render_completed', {
        ...logContext,
        captionLength: caption.length,
        messageLength: message.length,
        usePhoto,
      });

      if (openRouterImageEnabled() && usePhoto) {
        try {
          logger.info('image_generation_started', logContext);
          const image = await generateTelegramPostImage({ post });
          logger.info('image_generation_succeeded', {
            ...logContext,
            imageBytes: image.byteLength,
          });

          logger.info('telegram_send_started', {
            ...logContext,
            mode: 'photo',
          });
          await bot.api.sendPhoto(chatId, new InputFile(image, 'post.png'), {
            caption,
            parse_mode: 'HTML',
          });
          logger.info('telegram_send_succeeded', {
            ...logContext,
            mode: 'photo',
          });
        } catch (error) {
          logger.warn('image_generation_failed', {
            ...logContext,
            error: serializeError(error),
          });

          logger.info('telegram_send_started', {
            ...logContext,
            mode: 'text_after_image_failure',
          });
          await bot.api.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
          });
          logger.info('telegram_send_succeeded', {
            ...logContext,
            mode: 'text_after_image_failure',
          });
        }
      } else {
        if (openRouterImageEnabled() && !usePhoto) {
          logger.info('image_skipped_caption_too_long', {
            ...logContext,
            captionLength: caption.length,
          });
        }

        logger.info('telegram_send_started', {
          ...logContext,
          mode: 'text',
        });
        await bot.api.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
        logger.info('telegram_send_succeeded', {
          ...logContext,
          mode: 'text',
        });
      }

      await ack(item.id);
      sent += 1;

      logger.info('stream_item_acked', {
        ...logContext,
        sent,
      });

      await sleep(delayMs);
    }
  } finally {
    await closeRedis();
    logger.info('redis_closed');
  }

  logger.info('forwarder_finished', { ok: true, sent });
}

main().catch((error) => {
  logger.error('forwarder_failed', {
    error: serializeError(error),
  });
  process.exitCode = 1;
});
