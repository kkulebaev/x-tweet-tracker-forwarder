# x-tweet-tracker-forwarder

<p align="center">
  <img src="./assets/voyager-forwarder-banner.svg" alt="Voyager Forwarder" width="1200" />
</p>

Cron-style forwarder that:
1) reads events from **Redis Streams** (`voyager:tweets`)
2) sends posts to a Telegram group using **Voyager Bot token**
3) acknowledges processed stream entries

Behavior:
- drains the queue and **exits** when there are no more messages
- recovers stuck messages from the pending list (`XAUTOCLAIM`, min idle 60s)

## Environment variables
- `REDIS_URL` — Railway Redis connection string
- `TELEGRAM_BOT_TOKEN` — Voyager Bot token
- `TELEGRAM_CHAT_ID` — target group chat id (e.g. `-100...`)

OpenRouter (optional):

Text rewrite:
- `OPENROUTER_API_KEY`
- `OPENROUTER_TEXT_MODEL`

If `OPENROUTER_API_KEY` + `OPENROUTER_TEXT_MODEL` are set, the forwarder rewrites tweet text into a detailed Russian Telegram post before publishing.

Image generation:
- `OPENROUTER_API_KEY`
- `OPENROUTER_IMAGE_MODEL` (e.g. `google/gemini-2.5-flash-image`)

If `OPENROUTER_API_KEY` + `OPENROUTER_IMAGE_MODEL` are set, the forwarder generates an image for the final Telegram post text and publishes it as a photo with caption.

## Rate limit
- Sends **one message every 30 seconds** (hardcoded).

## Run
```bash
nvm use
npm ci
npm run build
npm start
```

Node version is pinned to `24.14.1` via `.nvmrc`, `package.json#engines`, and the Docker base image.

## Docker
Build image:
```bash
docker build -t x-tweet-tracker-forwarder .
```

Run container:
```bash
docker run --rm \
  -e REDIS_URL \
  -e TELEGRAM_BOT_TOKEN \
  -e TELEGRAM_CHAT_ID \
  -e OPENROUTER_API_KEY \
  -e OPENROUTER_TEXT_MODEL \
  -e OPENROUTER_IMAGE_MODEL \
  x-tweet-tracker-forwarder
```

