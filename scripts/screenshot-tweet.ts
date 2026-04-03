import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

function getUserAgent() {
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36';
}

function toDataUrl(args: { contentType: string; data: Uint8Array }) {
  const buf = Buffer.from(args.data);
  return `data:${args.contentType};base64,${buf.toString('base64')}`;
}

async function fetchAsDataUrl(url: string) {
  const res = await fetch(url, {
    headers: {
      // X / pbs.twimg.com can be picky; mimic a browser a bit.
      'user-agent': getUserAgent(),
      referer: 'https://x.com/',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const data = new Uint8Array(await res.arrayBuffer());
  return toDataUrl({ contentType, data });
}

function getStatusId(url: string) {
  const match = url.match(/\/status\/(\d+)/);
  if (!match) throw new Error(`Cannot parse status id from url: ${url}`);
  return match[1];
}

function getTweetUrlFromArgs(args: string[]) {
  const url = args[0];
  if (!url) {
    throw new Error('Usage: npm run screenshot -- "https://x.com/<user>/status/<id>"');
  }
  return url;
}

async function main() {
  const url = getTweetUrlFromArgs(process.argv.slice(2));
  const statusId = getStatusId(url);

  const screenshotsDir = path.join(process.cwd(), 'screenshots');
  await mkdir(screenshotsDir, { recursive: true });

  const outPath = path.join(screenshotsDir, `${statusId}.png`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    userAgent: getUserAgent(),
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const selector = `article:has(a[href*="/status/${statusId}"])`;
    const tweet = await page.waitForSelector(selector, { timeout: 20_000 });

    await tweet.scrollIntoViewIfNeeded();

    const avatarUrl = await tweet.evaluate((node) => {
      const img = node.querySelector('[data-testid="Tweet-User-Avatar"] img');
      return img?.getAttribute('src') ?? null;
    });

    let avatarDataUrl: string | null = null;

    if (avatarUrl) {
      try {
        avatarDataUrl = await fetchAsDataUrl(avatarUrl);
      } catch (e) {
        console.warn('avatar fetch failed (node fetch), will try playwright request', {
          url: avatarUrl,
          error: e instanceof Error ? e.message : String(e),
        });

        try {
          const res = await page.request.get(avatarUrl, {
            headers: {
              'user-agent': getUserAgent(),
              referer: 'https://x.com/',
            },
          });

          if (!res.ok()) {
            console.warn('avatar fetch failed (playwright request)', {
              url: avatarUrl,
              status: res.status(),
              statusText: res.statusText(),
            });
          } else {
            const contentType = res.headers()['content-type'] ?? 'application/octet-stream';
            const data = await res.body();
            avatarDataUrl = toDataUrl({ contentType, data });
          }
        } catch (e2) {
          console.warn('avatar fetch failed (playwright request exception)', {
            url: avatarUrl,
            error: e2 instanceof Error ? e2.message : String(e2),
          });
        }
      }
    }

    // Build a clean card: avatar + name + handle + tweet text only.
    const cardSelector = await tweet.evaluate(
      (node, args) => {
        const avatar = node.querySelector('[data-testid="Tweet-User-Avatar"]');
        const userName = node.querySelector('[data-testid="User-Name"]');
        const tweetText = node.querySelector('[data-testid="tweetText"]');

        if (!avatar || !userName || !tweetText) {
          throw new Error('Cannot build tweet card: missing avatar/name/text');
        }

      const id = `tweet-card-${Math.random().toString(16).slice(2)}`;

      // Minimal style: dark, rounded, padded.
      const container = document.createElement('div');
      container.id = id;
      container.style.position = 'fixed';
      container.style.left = '16px';
      container.style.top = '16px';
      container.style.zIndex = '2147483647';
      container.style.background = 'rgb(0, 0, 0)';
      container.style.border = '1px solid rgba(255,255,255,0.10)';
      container.style.borderRadius = '16px';
      container.style.padding = '16px';
      container.style.maxWidth = '900px';
      container.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.gap = '12px';
      header.style.alignItems = 'flex-start';

      const avatarClone = avatar.cloneNode(true) as HTMLElement;
      // Avoid grabbing links/overlays: keep only the img.
      const avatarImg = avatarClone.querySelector('img');
      avatarClone.innerHTML = '';
      if (avatarImg) {
        const currentSrc = avatarImg.getAttribute('src') ?? '';
        const nextSrc = args.avatarDataUrl ?? currentSrc;
        if (nextSrc) {
          avatarImg.setAttribute('src', nextSrc);
        }
        avatarImg.removeAttribute('srcset');
        avatarClone.append(avatarImg);
      }
      avatarClone.style.width = '48px';
      avatarClone.style.height = '48px';
      avatarClone.style.overflow = 'hidden';
      avatarClone.style.borderRadius = '999px';
      avatarClone.style.flex = '0 0 48px';
      avatarClone.style.background = 'rgba(255,255,255,0.08)';
      if (avatarImg) {
        (avatarImg as HTMLImageElement).style.width = '48px';
        (avatarImg as HTMLImageElement).style.height = '48px';
        (avatarImg as HTMLImageElement).style.objectFit = 'cover';
        (avatarImg as HTMLImageElement).style.display = 'block';
      }

      const nameBlock = document.createElement('div');
      nameBlock.style.display = 'flex';
      nameBlock.style.flexDirection = 'column';
      nameBlock.style.gap = '2px';

      const nameClone = userName.cloneNode(true) as HTMLElement;
      // Strip everything but plain text for name+handle
      const texts = (nameClone.textContent ?? '').trim().split(/\n+/).map((s) => s.trim()).filter(Boolean);
      const fullText = texts.join(' ');
      const atMatch = fullText.match(/@\S+/);
      const handle = atMatch ? atMatch[0] : '';
      const displayName = handle ? fullText.replace(handle, '').trim() : fullText;

      const nameEl = document.createElement('div');
      nameEl.textContent = displayName;
      nameEl.style.color = 'rgb(231, 233, 234)';
      nameEl.style.fontSize = '18px';
      nameEl.style.fontWeight = '700';
      nameEl.style.lineHeight = '1.2';

      const handleEl = document.createElement('div');
      handleEl.textContent = handle;
      handleEl.style.color = 'rgb(113, 118, 123)';
      handleEl.style.fontSize = '16px';
      handleEl.style.lineHeight = '1.2';

      nameBlock.append(nameEl, handleEl);

      header.append(avatarClone, nameBlock);

      const textClone = tweetText.cloneNode(true) as HTMLElement;
      const text = (textClone.textContent ?? '').trim();

      const body = document.createElement('div');
      body.textContent = text;
      body.style.marginTop = '12px';
      body.style.whiteSpace = 'pre-wrap';
      body.style.color = 'rgb(231, 233, 234)';
      body.style.fontSize = '18px';
      body.style.lineHeight = '1.35';

      container.append(header, body);
      document.body.append(container);

      return `#${id}`;
      },
      { avatarDataUrl },
    );

    const card = await page.waitForSelector(cardSelector, { timeout: 5_000 });

    // Wait for avatar image to be loaded inside the card (best effort).
    await page.waitForFunction(
      (sel) => {
        const root = document.querySelector(sel);
        const img = root?.querySelector('img');
        if (!img) return true;
        return img.complete && img.naturalWidth > 0;
      },
      cardSelector,
      { timeout: 10_000 },
    );

    const image = await card.screenshot({ type: 'png' });
    await writeFile(outPath, image);

    console.log(`saved screenshot: ${path.relative(process.cwd(), outPath)}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
