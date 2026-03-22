import 'dotenv/config';
import { Bot } from 'grammy';
import { mustEnv } from './env.js';
import { ack, autoClaimPending, ensureGroup, readOneNew } from './redis.js';

const MENTION = '@assistant_open_claw_bot';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
  });

  await ensureGroup();
  console.log('redis consumer group ensured');

  let sent = 0;
  let seen = 0;

  const consumer = 'voyager-forwarder-1';

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

    const msg = formatMessage({
      xUsername: payload.xUsername,
      url: payload.url,
      text: payload.text,
    });

    await bot.api.sendMessage(chatId, msg, {
      link_preview_options: { is_disabled: true },
    } as any);

    await ack(item.id);
    sent += 1;

    console.log('sent+acked', { id: item.id, sent });

    await sleep(delayMs);
  }

  console.log(JSON.stringify({ ok: true, sent }, null, 2));
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exitCode = 1;
});
