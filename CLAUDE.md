# CLAUDE.md

Этот файл содержит инструкции для Claude Code (claude.ai/code) при работе с кодом в этом репозитории.

## Команды

- `npm run dev` — локальный запуск воркера через `tsx` (читает `.env` через `dotenv`)
- `npm run typecheck` — `tsc --noEmit`, единственный источник истины для ошибок типов (отдельного шага линтинга нет)
- `npm test` — `vitest run`. Используйте `npm run test:watch` для TDD, `npm run test:coverage` для покрытия V8
- Одиночный тест: `npx vitest run tests/<file>.test.ts -t "<name pattern>"`
- `npm run build` && `npm start` — компиляция в `dist/` и запуск продакшен-входа
- `npm run dry-run:archetypes -- --author <user> --url <url> --text "<tweet>"` — прогон одного и того же твита через все архетипы для ручной проверки (также `--text-file`, `--json`)
- Версия Node зафиксирована на `24.14.1` в `.nvmrc`, `package.json#engines` и базовом образе Docker — используйте `nvm use` перед установкой

## Модель исполнения

Это **одноразовый воркер-сливщик** (one-shot drain), а не демон. `src/index.ts#main` крутится в цикле, пока Redis-стрим не опустеет, после чего корректно завершается. Предполагается запуск по расписанию (cron / Docker run).

Тайминги зашиты в код:
- скорость отправки: **1 сообщение в 30 секунд** (`delayMs` в `src/index.ts`)
- порог реклейма зависших записей: **60 секунд простоя** через `XAUTOCLAIM`
- таймаут блокировки `XREADGROUP`: **1500 мс** — когда возвращается пусто, цикл прерывается и процесс завершается

Каждая итерация: сначала `XAUTOCLAIM` (восстановление застрявших записей из той же consumer-группы `forwarder`), затем `XREADGROUP` для новой записи, валидация, генерация, рендер, выбор способа доставки, отправка, `XACK`, сон. Некорректные пейлоады (без `url`) подтверждаются и пропускаются; ошибки валидации структурированного поста от OpenRouter (`isInvalidStructuredPostError`) также подтверждаются и отбрасываются (недавний фикс `0d0f774`).

## Архитектура

Пайплайн намеренно разбит на чистые модули вокруг императивного драйвера `index.ts`. Большая часть логики покрывается юнит-тестами; из покрытия исключены только `index.ts`, `openrouter-*.ts`, `redis.ts`, `env.ts`, `logger.ts` и `scripts/` (`vitest.config.ts`).

**Контракт стрима** (`src/redis.ts`)
- Ключ стрима: `voyager:tweets`, consumer group: `forwarder`, имя консьюмера: `voyager-forwarder-1`
- Записи содержат единственное поле `payload` с JSON, соответствующим `TweetEventPayload` (tweetId, xUsername, url, text, createdAt, опциональный `media[]`)
- Все ответы `XREADGROUP` / `XAUTOCLAIM` проходят через type guards `isXReadGroupResponse` / `isAutoClaimResponse` — сохраняйте их при правках этого файла

**Слой переписывания** (`src/openrouter-text.ts`, `src/rewrite-config.ts`, `src/system-prompt.ts`, `src/post-contract.ts`, `src/archetype-selector.ts`)
- `rewriteConfig` (версионируется через `configVersion`) задаёт правила голоса, инварианты и **каталог архетипов** (`contrarian-take`, `mini-list`, `problem-insight`, `micro-story-takeaway`, `plain-punchline`). Каждый архетип ограничивает `allowedBlockTypes` и риторические приёмы.
- Для боевых отправок `selectRandomArchetype` выбирает один равномерно; dry-run скрипт проходит по всем.
- Системный промпт собирается из голоса + инвариантов + контракта выбранного архетипа + JSON-схемы вывода. Модель обязана вернуть строгий JSON `StructuredTelegramPost`; `parseStructuredTelegramPost` валидирует его (включая совпадение возвращённых `archetype`, `configVersion`, `sourceTweetId` с инжектированными, а также допустимость типов блоков в `allowedBlockTypes`).
- Один автоматический ретрай при ошибке валидации, со списком ошибок валидатора, переданным обратно в диалог. Повторный сбой бросает `InvalidStructuredPostError` (распознаётся через `isInvalidStructuredPostError`).

**Политика доставки** (`src/delivery-policy.ts`)
- Двухфазная: `classifyRawTweet` формирует `RawTweetSignals` на регулярных эвристиках (announcement/news/link/thread); `decideDeliveryMode` затем выбирает `source_photo` | `generated_photo` | `text`.
- `source_photo` побеждает всегда, когда у твита ровно одно фото и отрендеренная подпись укладывается в лимит Telegram 1024 символа.
- Иначе вычисляется eligibility: посты с announcement/news/link и любые посты с исходным фото **исключаются** из генерации. Подходящие посты делятся детерминированно 50/50 по SHA-256 от `tweetId || url` (`pickGenerationBucket`) — один и тот же твит всегда попадает в один и тот же бакет.
- Константы `DELIVERY_TARGET_GENERATION_RATIO` и `DELIVERY_EXCLUDE_ANNOUNCEMENTS` намеренно живут в коде, а не в env (согласно README).

**Рендер** (`src/telegram-render.ts`)
- HTML-вывод (Telegram `parse_mode: 'HTML'`). `escapeHtml` выполняется до любой inline-трансформации; `@mentions` превращаются в ссылки `<a href="https://x.com/...">` через `renderInlineText`.
- Два режима рендера: `renderTelegramCaption` (без URL, ужимается до целевых 900 символов под жёстким лимитом 1024) и `renderTelegramMessage` (с URL, цель 1400 символов, обрезка как крайняя мера). `compactPost` сжимает списки, затем длинные блоки, затем CTA, затем отбрасывает хвостовые блоки.
- `buildFallbackStructuredPost` существует, но **не подключён** в `index.ts` — невалидные посты отбрасываются, а не рендерятся через fallback.

**Решение о link preview** (`src/link-preview.ts`)
- Включается только при `mode === 'text'`. Считает контентные URL в отрендеренном HTML (анкоры, не являющиеся ссылками `@mention`, + plaintext-URL).
- Превью включается только если есть **ровно один** контентный URL и его канонизированная форма (`canonicalizeUrl` срезает tracking-параметры, нормализует `twitter.com → x.com`, убирает хвостовую пунктуацию) равна канонической ссылке исходного твита. Иначе ставится `link_preview_options: { is_disabled: true }`.

**Генерация изображений** (`src/openrouter-image.ts`)
- Активна только при заданном `OPENROUTER_IMAGE_MODEL`. При сбое `index.ts` откатывается к текстовой отправке и заново вызывает `shouldEnableLinkPreview` для текстового пути (режимы логирования `text_with_preview_after_image_failure` / `text_after_image_failure`).

**Загрузка исходного фото** (`src/index.ts#downloadPhotoAsInputFile`)
- Перезаливает исходное фото как `Buffer`, а не передаёт URL в Telegram (недавний фикс `7b41703`). Подменяет User-Agent на Chrome и определяет расширение по `content-type` или суффиксу URL.

## Логирование

Единственный структурированный логгер в `src/logger.ts` — пишет одну JSON-строку на событие с `ts`, `level`, `event` и произвольным контекстом. Ошибки нормализуются через `serializeError` (сохраняет `name`, `message`, `stack`, `cause`). При добавлении новых точек логирования используйте существующий стиль имён `event` (`snake_case`, с префиксом области: `redis_*`, `telegram_*`, `structured_post_*`, `image_generation_*`) — README и наблюдаемость завязаны на эти имена. Поля `decision_*` (`deliveryMode`, `decisionReasons`, `isGenerationEligible`, `generationBucket`, `linkPreviewEnabled`, `linkPreviewReason`, `contentUrlCount`) являются частью контракта для последующего анализа.

## Соглашения, которые стоит сохранять

- ESM везде (`"type": "module"`, `tsconfig` `module: ES2022`). Внутренние импорты используют расширение `.js` даже для исходников `.ts` — это требуется для ESM-резолва после компиляции.
- Строгий TypeScript. Никакого `any`; используйте type guards (`isRecord`, `isStreamEntry` и т. п.) на любой границе, где встречается `unknown`.
- `mustEnv(key)` — единственный санкционированный способ читать обязательные env-переменные; бросает при отсутствии или пустом значении.
- Не вводите отдельный конфигурационный файл для архетипов/политики — `rewriteConfig` является единственным источником истины и версионируется через `configVersion` (поднимайте версию, если изменения архетипов должны инвалидировать ранее залогированные сравнения).
