import 'dotenv/config';
import { Bot } from 'grammy';
import { claimOne, markSent } from './api.js';
import { envInt, mustEnv } from './env.js';

const MENTION = '@assistant_open_claw_bot';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatMessage(args: { xUsername?: string | null; url: string; text: string }) {
  const header = `${MENTION} новый твит от @${args.xUsername ?? 'unknown'}`;
  // Keep it simple: plain text, no previews should be handled by Telegram settings.
  return `${header}\n${args.url}\n\n${args.text}`.trim();
}

async function main() {
  const bot = new Bot(mustEnv('TELEGRAM_BOT_TOKEN'));
  const chatId = Number(mustEnv('TELEGRAM_CHAT_ID'));

  const delaySeconds = envInt('SEND_INTERVAL_SECONDS', 30);
  const delayMs = Math.max(1, delaySeconds) * 1000;

  let sent = 0;

  while (true) {
    const r = await claimOne();
    if (!r.tweet) break;

    const msg = formatMessage({
      xUsername: r.account?.xUsername ?? null,
      url: r.tweet.url,
      text: r.tweet.text,
    });

    await bot.api.sendMessage(chatId, msg, {
      // grammY types prefer link_preview_options, but this flag works in Telegram API as well
      link_preview_options: { is_disabled: true },
    } as any);

    await markSent(r.tweet.tweet_id);
    sent += 1;

    // throttle
    await sleep(delayMs);
  }

  console.log(JSON.stringify({ ok: true, sent }, null, 2));
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exitCode = 1;
});
