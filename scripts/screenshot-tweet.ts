import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

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
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const selector = `article:has(a[href*="/status/${statusId}"])`;
    const tweet = await page.waitForSelector(selector, { timeout: 20_000 });

    await tweet.scrollIntoViewIfNeeded();

    // Hide engagement buttons/metrics (replies / reposts / likes / share / bookmarks)
    await page.addStyleTag({
      content: `
        [data-testid="reply"],
        [data-testid="retweet"],
        [data-testid="like"],
        [data-testid="removeBookmark"],
        [data-testid="bookmark"],
        [data-testid="unbookmark"],
        button[aria-label*="Поделиться"],
        button[aria-label*="Share"],
        div[role="group"][aria-label*="ответ"],
        div[role="group"][aria-label*="Replies"],
        div[role="group"][aria-label*="repost"],
        div[role="group"][aria-label*="Retweet"],
        div[role="group"][aria-label*="Like"] {
          display: none !important;
          visibility: hidden !important;
        }
      `,
    });

    const image = await tweet.screenshot({ type: 'png' });
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
