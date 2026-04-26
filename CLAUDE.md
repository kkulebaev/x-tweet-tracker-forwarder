# CLAUDE.md

This file contains instructions for Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — run the worker locally via `tsx` (reads `.env` through `dotenv`)
- `npm run typecheck` — `tsc --noEmit`, the single source of truth for type errors (there is no separate lint step)
- `npm test` — `vitest run`. Use `npm run test:watch` for TDD, `npm run test:coverage` for V8 coverage
- Single test: `npx vitest run tests/<file>.test.ts -t "<name pattern>"`
- `npm run build` && `npm start` — compile to `dist/` and run the production entry point
- `npm run dry-run:archetypes -- --author <user> --url <url> --text "<tweet>"` — run the same tweet through every archetype for manual inspection (also `--text-file`, `--json`)
- The Node version is pinned to `24.14.1` in `.nvmrc`, `package.json#engines`, and the Docker base image — run `nvm use` before installing

## Execution model

This is a **one-shot drain worker**, not a daemon. `src/index.ts#main` loops until the Redis stream is empty, then exits cleanly. It is meant to be run on a schedule (cron / Docker run).

Timings are hard-coded:
- send rate: **1 message every 30 seconds** (`delayMs` in `src/index.ts`)
- stuck-entry reclaim threshold: **60 seconds idle** via `XAUTOCLAIM`
- `XREADGROUP` block timeout: **1500 ms** — when it returns empty, the loop breaks and the process exits

Each iteration: first `XAUTOCLAIM` (recovers stuck entries from the same `forwarder` consumer group), then `XREADGROUP` for a new entry, validation, generation, render, delivery-mode selection, send, `XACK`, sleep. Malformed payloads (missing `url`) are acked and skipped; structured-post validation errors from OpenRouter (`isInvalidStructuredPostError`) are also acked and dropped (recent fix `0d0f774`).

## Architecture

The pipeline is intentionally split into pure modules around the imperative driver `index.ts`. Most of the logic is covered by unit tests; only `index.ts`, `openrouter-*.ts`, `redis.ts`, `env.ts`, `logger.ts`, and `scripts/` are excluded from coverage (`vitest.config.ts`).

**Stream contract** (`src/redis.ts`)
- Stream key: `voyager:tweets`, consumer group: `forwarder`, consumer name: `voyager-forwarder-1`
- Entries contain a single `payload` field with JSON matching `TweetEventPayload` (tweetId, xUsername, url, text, createdAt, optional `media[]`)
- All `XREADGROUP` / `XAUTOCLAIM` responses go through the type guards `isXReadGroupResponse` / `isAutoClaimResponse` — keep them when editing this file

**Rewrite layer** (`src/openrouter-text.ts`, `src/rewrite-config.ts`, `src/system-prompt.ts`, `src/post-contract.ts`, `src/archetype-selector.ts`)
- `rewriteConfig` (versioned via `configVersion`) defines voice rules, invariants, and the **archetype catalog** (`contrarian-take`, `mini-list`, `problem-insight`, `micro-story-takeaway`, `plain-punchline`). Each archetype constrains `allowedBlockTypes` and rhetorical devices.
- For production sends, `selectRandomArchetype` picks one uniformly; the dry-run script iterates over all of them.
- The system prompt is assembled from voice + invariants + the chosen archetype's contract + the JSON output schema. The model must return strict JSON `StructuredTelegramPost`; `parseStructuredTelegramPost` validates it (including that the returned `archetype`, `configVersion`, `sourceTweetId` match the injected ones, and that block types are within `allowedBlockTypes`).
- One automatic retry on validation failure, with the validator error list fed back into the conversation. A repeat failure throws `InvalidStructuredPostError` (recognized via `isInvalidStructuredPostError`).

**Delivery policy** (`src/delivery-policy.ts`)
- Two-phase: `classifyRawTweet` builds `RawTweetSignals` from regex heuristics (announcement/news/link/thread); `decideDeliveryMode` then picks `source_photo` | `generated_photo` | `text`.
- `source_photo` always wins when the tweet has exactly one photo and the rendered caption fits within Telegram's 1024-character limit.
- Otherwise eligibility is computed: announcement/news/link posts and any posts with a source photo are **excluded** from generation. Eligible posts are split deterministically 50/50 by SHA-256 of `tweetId || url` (`pickGenerationBucket`) — the same tweet always lands in the same bucket.
- The constants `DELIVERY_TARGET_GENERATION_RATIO` and `DELIVERY_EXCLUDE_ANNOUNCEMENTS` deliberately live in code, not env (per the README).

**Rendering** (`src/telegram-render.ts`)
- HTML output (Telegram `parse_mode: 'HTML'`). `escapeHtml` runs before any inline transformation; `@mentions` are turned into `<a href="https://x.com/...">` links via `renderInlineText`.
- Two render modes: `renderTelegramCaption` (no URL, compacted toward 900 characters under the hard 1024 limit) and `renderTelegramMessage` (with URL, target 1400 characters, truncation as a last resort). `compactPost` shrinks lists, then long blocks, then the CTA, then drops trailing blocks.
- `buildFallbackStructuredPost` exists but is **not wired into** `index.ts` — invalid posts are dropped rather than rendered via the fallback.

**Link preview decision** (`src/link-preview.ts`)
- Only enabled when `mode === 'text'`. Counts content URLs in the rendered HTML (anchors that are not `@mention` links + plaintext URLs).
- Preview is enabled only if there is **exactly one** content URL and its canonical form (`canonicalizeUrl` strips tracking parameters, normalizes `twitter.com → x.com`, removes trailing punctuation) equals the canonical source-tweet URL. Otherwise `link_preview_options: { is_disabled: true }` is set.

**Image generation** (`src/openrouter-image.ts`)
- Active only when `OPENROUTER_IMAGE_MODEL` is set. On failure, `index.ts` falls back to text delivery and re-invokes `shouldEnableLinkPreview` for the text path (logging modes `text_with_preview_after_image_failure` / `text_after_image_failure`).

**Source photo upload** (`src/index.ts#downloadPhotoAsInputFile`)
- Re-uploads the source photo as a `Buffer` rather than handing the URL to Telegram (recent fix `7b41703`). Spoofs the User-Agent to Chrome and infers the extension from `content-type` or the URL suffix.

## Logging

The single structured logger lives in `src/logger.ts` — it writes one JSON line per event with `ts`, `level`, `event`, and arbitrary context. Errors are normalized through `serializeError` (preserves `name`, `message`, `stack`, `cause`). When adding new logging points, follow the existing `event` naming style (`snake_case`, prefixed by area: `redis_*`, `telegram_*`, `structured_post_*`, `image_generation_*`) — the README and observability are tied to these names. The `decision_*` fields (`deliveryMode`, `decisionReasons`, `isGenerationEligible`, `generationBucket`, `linkPreviewEnabled`, `linkPreviewReason`, `contentUrlCount`) are part of the contract for downstream analysis.

## Conventions worth preserving

- ESM throughout (`"type": "module"`, `tsconfig` `module: ES2022`). Internal imports use the `.js` extension even for `.ts` sources — this is required for ESM resolution after compilation.
- Strict TypeScript. No `any`; use type guards (`isRecord`, `isStreamEntry`, etc.) at any boundary where `unknown` appears.
- `mustEnv(key)` is the only sanctioned way to read required env vars; it throws on missing or empty values.
- Do not introduce a separate config file for archetypes/policy — `rewriteConfig` is the single source of truth and is versioned via `configVersion` (bump it whenever archetype changes should invalidate previously logged comparisons).
