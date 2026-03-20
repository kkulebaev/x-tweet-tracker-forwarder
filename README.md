# x-tweet-tracker-forwarder

Service that:
1) claims the next unsent tweet from **Voyager API**
2) sends it to a Telegram group using **Voyager Bot token**
3) marks the tweet as sent

It sends **one tweet at a time** with a delay between messages.

Mention is hardcoded in the message format:
- `@assistant_open_claw_bot`

## Environment variables
- `API_BASE_URL`
  - public: `https://x-tweet-tracker-production.up.railway.app`
  - private: `x-tweet-tracker.railway.internal` (auto → `http://...:8080`)
- `API_TOKEN` — same value as API `ADMIN_TOKEN`
- `TELEGRAM_BOT_TOKEN` — Voyager Bot token
- `TELEGRAM_CHAT_ID` — target group chat id (e.g. `-100...`)
- `SEND_INTERVAL_SECONDS` — delay between messages (default: 30)

## Run
```bash
npm ci
npm run build
npm start
```
