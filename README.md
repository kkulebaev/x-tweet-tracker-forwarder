# x-tweet-tracker-forwarder

<p align="center">
  <img src="./assets/voyager-forwarder-banner.svg" alt="Voyager Forwarder" width="1200" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-24.14.1-339933?logo=node.js&logoColor=white" alt="Node 24.14.1" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Telegram-Forwarder-26A5E4?logo=telegram&logoColor=white" alt="Telegram Forwarder" />
  <img src="https://img.shields.io/badge/Redis-Streams-DC382D?logo=redis&logoColor=white" alt="Redis Streams" />
  <img src="https://img.shields.io/badge/OpenRouter-optional-7C3AED" alt="OpenRouter optional" />
</p>

A queue-draining forwarder that reads tweet events from Redis Streams, turns them into polished Telegram posts, and delivers them to a Telegram group.

## What it does

- consumes events from the `voyager:tweets` Redis stream
- uses a Redis consumer group named `forwarder`
- rewrites incoming tweet text into a structured Russian Telegram post via OpenRouter text generation
- optionally generates a matching image via OpenRouter and sends the post as a photo with caption
- falls back to a plain text Telegram message when image generation fails or the caption would be too long
- acknowledges processed stream entries after successful delivery
- reclaims stuck pending entries with `XAUTOCLAIM`
- drains the queue and exits when no more messages are available

## Message flow

1. Read one reclaimed or fresh stream item
2. Validate payload and require a tweet URL
3. Generate a structured Telegram post
4. Render Telegram HTML
5. Try to generate an image if image mode is enabled and the caption fits Telegram limits
6. Send to Telegram
7. Acknowledge the Redis stream entry
8. Wait 30 seconds before the next send

## Requirements

- Node.js `24.14.1`
- Redis with access to the `voyager:tweets` stream
- Telegram bot token and target chat id
- OpenRouter text generation enabled
- OpenRouter image generation enabled only if you want photo posts

## Environment variables

### Required

- `REDIS_URL` — Redis connection string
- `TELEGRAM_BOT_TOKEN` — Telegram bot token
- `TELEGRAM_CHAT_ID` — target Telegram chat id, for example `-100...`
- `OPENROUTER_API_KEY` — OpenRouter API key
- `OPENROUTER_TEXT_MODEL` — text model used to generate the structured Telegram post

### Optional

- `OPENROUTER_IMAGE_MODEL` — image model used to generate a post illustration, for example `google/gemini-2.5-flash-image`

The rewrite layer uses config-driven archetypes. On each production generation it preselects one archetype via pure random, injects that contract into the prompt, and logs both the chosen archetype and rewrite config version.

Current archetypes:
- `contrarian-take`
- `mini-list`
- `problem-insight`
- `micro-story-takeaway`
- `plain-punchline`

If `OPENROUTER_IMAGE_MODEL` is not set, the service sends text-only Telegram messages.

## Behavior details

- send rate is hardcoded to **1 message every 30 seconds**
- pending messages are reclaimed after **60 seconds** of idle time
- Telegram messages are rendered with HTML formatting
- link previews are disabled for text messages
- image sending is skipped when the rendered caption exceeds Telegram caption limits
- malformed entries without a valid URL are acknowledged and skipped
- if OpenRouter text generation is disabled, the process fails fast

## Local run

```bash
nvm use
npm ci
npm run typecheck
npm run build
npm start
```

## Dry-run compare-all
Use the dedicated script to run the same source tweet through all configured archetypes for manual review.

```bash
npm run dry-run:archetypes -- \
  --author kkulebaev \
  --url https://x.com/example/status/123 \
  --text "Your source tweet text here"
```

JSON output is also available:

```bash
npm run dry-run:archetypes -- --json --text-file ./tweet.txt
```

## Docker

Build the image:

```bash
docker build -t x-tweet-tracker-forwarder .
```

Run the container:

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

## Notes

- The project is designed to run like a cron job or one-shot worker, not as a forever-running daemon.
- Node version is pinned to `24.14.1` via `.nvmrc`, `package.json#engines`, and the Docker base image.
- The README badges are intentionally low-maintenance and describe stable stack choices instead of frequently changing stats.
