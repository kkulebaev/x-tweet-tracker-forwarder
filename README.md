# x-tweet-tracker-forwarder

Cron-style forwarder that:
1) reads events from **Redis Streams** (`voyager:tweets`)
2) sends posts to a Telegram group using **Voyager Bot token**
3) acknowledges processed stream entries

It drains the queue and exits when there are no more messages.

Mention is hardcoded in the message format:
- `@assistant_open_claw_bot`

## Environment variables
- `REDIS_URL` — Railway Redis connection string
- `TELEGRAM_BOT_TOKEN` — Voyager Bot token
- `TELEGRAM_CHAT_ID` — target group chat id (e.g. `-100...`)

## Rate limit
- Sends **one message every 30 seconds** (hardcoded).

## Run
```bash
npm ci
npm run build
npm start
```
