import 'dotenv/config';
import { Bot, InputFile } from 'grammy';
import { mustEnv } from './env.js';
import { logger, serializeError } from './logger.js';
import { generateStructuredTelegramPost, openRouterEnabled } from './openrouter-text.js';
import { generateTelegramPostImage, openRouterImageEnabled } from './openrouter-image.js';
import { canSendAsPhotoCaption, renderTelegramCaption, renderTelegramMessage } from './telegram-render.js';
import { ack, autoClaimPending, closeRedis, ensureGroup, readOneNew, type TweetEventMedia } from './redis.js';
import { classifyRawTweet, decideDeliveryMode } from './delivery-policy.js';
import { shouldEnableLinkPreview } from './link-preview.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getSinglePhotoMedia(media: TweetEventMedia[] | undefined) {
  if (!Array.isArray(media) || media.length !== 1) return null;

  const single = media[0];
  if (!single) return null;
  if (single.type !== 'photo') return null;
  if (!single.url.trim()) return null;

  return single;
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

      const rawSignals = classifyRawTweet(payload);
      logger.info('delivery_policy_raw_signals', {
        ...logContext,
        ...rawSignals,
      });

      if (!openRouterEnabled()) {
        throw new Error('OPENROUTER text generation must be enabled');
      }

      logger.info('structured_post_generation_started', logContext);
      const generated = await generateStructuredTelegramPost({
        xUsername: payload.xUsername,
        url: payload.url,
        text: payload.text,
        sourceTweetId: payload.tweetId,
      });
      const post = generated.post;
      logger.info('structured_post_generation_succeeded', {
        ...logContext,
        archetypeId: generated.archetypeId,
        configVersion: generated.configVersion,
        bodyBlocksCount: post.bodyBlocks.length,
        hasCta: Boolean(post.cta),
        titleLength: post.title.length,
      });

      const caption = renderTelegramCaption({ post });
      const message = renderTelegramMessage({ post, url: payload.url });
      const singlePhoto = getSinglePhotoMedia(payload.media);
      const canUsePhotoCaption = canSendAsPhotoCaption(caption);
      const deliveryDecision = decideDeliveryMode({
        rawSignals,
        post,
        canUsePhotoCaption,
        imageGenerationEnabled: openRouterImageEnabled(),
        generationSeed: payload.tweetId || payload.url,
      });
      const linkPreviewDecision = shouldEnableLinkPreview({
        mode: deliveryDecision.mode,
        message,
        sourceTweetUrl: payload.url,
      });

      logger.info('telegram_render_completed', {
        ...logContext,
        captionLength: caption.length,
        messageLength: message.length,
        hasSingleSourcePhoto: Boolean(singlePhoto),
        deliveryMode: deliveryDecision.mode,
        decisionReasons: deliveryDecision.reasons,
        isGenerationEligible: deliveryDecision.isGenerationEligible,
        generationBucket: deliveryDecision.generationBucket,
        linkPreviewEnabled: linkPreviewDecision.enabled,
        linkPreviewReason: linkPreviewDecision.reason,
        contentUrlCount: linkPreviewDecision.contentUrlCount,
        captionFitsPhotoLimit: canUsePhotoCaption,
      });

      if (deliveryDecision.mode === 'source_photo' && singlePhoto) {
        logger.info('telegram_send_started', {
          ...logContext,
          mode: 'source_photo',
        });
        await bot.api.sendPhoto(chatId, singlePhoto.url, {
          caption,
          parse_mode: 'HTML',
        });
        logger.info('telegram_send_succeeded', {
          ...logContext,
          mode: 'source_photo',
        });
      } else if (deliveryDecision.mode === 'generated_photo') {
        try {
          logger.info('image_generation_started', {
            ...logContext,
            generationBucket: deliveryDecision.generationBucket,
            decisionReasons: deliveryDecision.reasons,
          });
          const image = await generateTelegramPostImage({ post });
          logger.info('image_generation_succeeded', {
            ...logContext,
            imageBytes: image.byteLength,
          });

          logger.info('telegram_send_started', {
            ...logContext,
            mode: 'generated_photo',
          });
          await bot.api.sendPhoto(chatId, new InputFile(image, 'post.png'), {
            caption,
            parse_mode: 'HTML',
          });
          logger.info('telegram_send_succeeded', {
            ...logContext,
            mode: 'generated_photo',
          });
        } catch (error) {
          logger.warn('image_generation_failed', {
            ...logContext,
            error: serializeError(error),
          });

          const fallbackPreviewDecision = shouldEnableLinkPreview({
            mode: 'text',
            message,
            sourceTweetUrl: payload.url,
          });
          const fallbackMode = fallbackPreviewDecision.enabled ? 'text_with_preview_after_image_failure' : 'text_after_image_failure';
          logger.info('telegram_send_started', {
            ...logContext,
            mode: fallbackMode,
            linkPreviewEnabled: fallbackPreviewDecision.enabled,
            linkPreviewReason: fallbackPreviewDecision.reason,
            contentUrlCount: fallbackPreviewDecision.contentUrlCount,
          });
          await bot.api.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            link_preview_options: fallbackPreviewDecision.enabled ? undefined : { is_disabled: true },
          });
          logger.info('telegram_send_succeeded', {
            ...logContext,
            mode: fallbackMode,
          });
        }
      } else {
        if (singlePhoto && !canUsePhotoCaption) {
          logger.info('source_photo_skipped_caption_too_long', {
            ...logContext,
            captionLength: caption.length,
          });
        } else if (openRouterImageEnabled() && !canUsePhotoCaption) {
          logger.info('image_skipped_caption_too_long', {
            ...logContext,
            captionLength: caption.length,
          });
        }

        logger.info('telegram_send_started', {
          ...logContext,
          mode: deliveryDecision.mode,
          linkPreviewEnabled: linkPreviewDecision.enabled,
          linkPreviewReason: linkPreviewDecision.reason,
          contentUrlCount: linkPreviewDecision.contentUrlCount,
        });
        await bot.api.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          link_preview_options: linkPreviewDecision.enabled ? undefined : { is_disabled: true },
        });
        logger.info('telegram_send_succeeded', {
          ...logContext,
          mode: deliveryDecision.mode,
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
