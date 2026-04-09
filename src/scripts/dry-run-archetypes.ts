import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { generateStructuredTelegramPostForArchetype, openRouterEnabled, type StructuredGenerationArgs } from '../openrouter-text.js';
import { rewriteConfig, type ArchetypeId } from '../rewrite-config.js';
import { renderTelegramMessage } from '../telegram-render.js';

type DryRunFormat = 'pretty' | 'json';

type DryRunArgs = StructuredGenerationArgs & {
  format: DryRunFormat;
};

type DryRunResult = {
  archetypeId: ArchetypeId;
  configVersion: string;
  post: Awaited<ReturnType<typeof generateStructuredTelegramPostForArchetype>>['post'];
  renderedMessage: string;
};

function getOption(name: string, argv: string[]) {
  const prefixed = `--${name}`;
  const index = argv.findIndex((arg) => arg === prefixed);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function hasFlag(name: string, argv: string[]) {
  return argv.includes(`--${name}`);
}

async function resolveText(argv: string[]) {
  const directText = getOption('text', argv);
  if (directText && directText.trim()) {
    return directText.trim();
  }

  const textFile = getOption('text-file', argv);
  if (textFile) {
    const content = await readFile(textFile, 'utf8');
    const trimmed = content.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

async function parseArgs(argv: string[]): Promise<DryRunArgs> {
  const text = await resolveText(argv);
  if (!text) {
    throw new Error('Provide tweet text with --text "..." or --text-file path');
  }

  return {
    xUsername: getOption('author', argv),
    url: getOption('url', argv) ?? 'https://x.com/example/status/dry-run',
    text,
    format: hasFlag('json', argv) ? 'json' : 'pretty',
  };
}

export async function runDryRunCompareAll(args: DryRunArgs): Promise<DryRunResult[]> {
  const results: DryRunResult[] = [];

  for (const archetype of rewriteConfig.archetypes) {
    const generated = await generateStructuredTelegramPostForArchetype({
      xUsername: args.xUsername,
      url: args.url,
      text: args.text,
      archetypeId: archetype.id,
    });

    results.push({
      archetypeId: generated.archetypeId,
      configVersion: generated.configVersion,
      post: generated.post,
      renderedMessage: renderTelegramMessage({
        post: generated.post,
        url: args.url,
      }),
    });
  }

  return results;
}

function printPretty(results: DryRunResult[]) {
  for (const result of results) {
    console.log('='.repeat(80));
    console.log(`archetype: ${result.archetypeId}`);
    console.log(`configVersion: ${result.configVersion}`);
    console.log('-'.repeat(80));
    console.log(result.renderedMessage);
    console.log();
  }
}

async function main() {
  if (!openRouterEnabled()) {
    throw new Error('OPENROUTER_API_KEY and OPENROUTER_TEXT_MODEL must be set');
  }

  const args = await parseArgs(process.argv.slice(2));
  const results = await runDryRunCompareAll(args);

  if (args.format === 'json') {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  printPretty(results);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
