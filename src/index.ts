import 'dotenv/config';
import { Bot } from 'grammy';
import { mustEnv } from './env.js';
import { ack, ensureGroup, readOne } from './redis.js';

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

  await ensureGroup();

  let sent = 0;

  // Drain the queue until it becomes empty.
  while (true) {
    const item = await readOne('voyager-forwarder-1', 1500);
    if (!item) break;

    const payload = item.payload;
    if (!payload?.url) {
      // Skip malformed message
      await ack(item.id);
      continue;
    }

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

    await sleep(delayMs);
  }

  console.log(JSON.stringify({ ok: true, sent }, null, 2));
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exitCode = 1;
});
