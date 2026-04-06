# x-tweet-tracker-forwarder

<p align="center">
  <img src="./assets/voyager-forwarder-banner.svg" alt="Voyager Forwarder" width="1200" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Telegram-channel%20posts-26A5E4?logo=telegram&logoColor=white" alt="Telegram channel posts" />
  <img src="https://img.shields.io/badge/Redis-event%20queue-DC382D?logo=redis&logoColor=white" alt="Redis event queue" />
  <img src="https://img.shields.io/badge/OpenRouter-AI%20rewrite%20optional-7C3AED" alt="OpenRouter AI rewrite optional" />
</p>

Voyager Forwarder takes tweet events from a queue and turns them into polished Telegram posts.

## Overview

It is built for a simple flow:

- pick up new tweet events
- transform them into cleaner, more readable Telegram content
- optionally enrich posts with generated visuals
- publish them to a Telegram chat

The goal is to keep raw source material lightweight, while the Telegram output feels more editorial and channel-ready.

## What it is good for

- forwarding curated tweet discoveries into a Telegram channel or group
- turning short source material into fuller posts with clearer framing
- keeping a publishing pipeline small and easy to run
- adding optional AI-assisted rewriting and visuals without changing the overall workflow

## Configuration

Set the environment variables needed for:

- Redis access
- Telegram bot access
- target Telegram chat selection
- optional AI text generation
- optional AI image generation

## Run locally

```bash
nvm use
npm ci
npm run build
npm start
```

## Docker

```bash
docker build -t x-tweet-tracker-forwarder .

docker run --rm \
  -e REDIS_URL \
  -e TELEGRAM_BOT_TOKEN \
  -e TELEGRAM_CHAT_ID \
  -e OPENROUTER_API_KEY \
  -e OPENROUTER_TEXT_MODEL \
  -e OPENROUTER_IMAGE_MODEL \
  x-tweet-tracker-forwarder
```
