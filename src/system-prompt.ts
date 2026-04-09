import type { RewriteArchetype, RewriteConfig } from './rewrite-config.js';

function buildListSection(title: string, lines: string[]) {
  return [title, ...lines.map((line) => `- ${line}`)].join('\n');
}

export function buildVoiceSection(config: RewriteConfig) {
  return buildListSection('Голос и стиль:', config.voiceRules);
}

export function buildInvariantSection(config: RewriteConfig) {
  return buildListSection('Инварианты перепаковки:', config.rewriteInvariants);
}

export function buildArchetypeSection(archetype: RewriteArchetype) {
  return [
    'Выбранный архетип:',
    `- id: ${archetype.id}`,
    `- label: ${archetype.label}`,
    `- purpose: ${archetype.purpose}`,
    `- lengthBand: ${archetype.lengthBand}`,
    `- allowedBlockTypes: ${archetype.allowedBlockTypes.join(', ')}`,
    '- structuralContract:',
    ...archetype.structuralContract.map((line) => `  - ${line}`),
    `- allowedDevices: ${archetype.allowedDevices.join(', ') || 'none'}`,
    `- disallowedDevices: ${archetype.disallowedDevices.join(', ') || 'none'}`,
  ].join('\n');
}

export function buildOutputContractSection() {
  return [
    'Строгая JSON-схема ответа:',
    '{',
    '  "archetype": "contrarian-take",',
    '  "titleEmoji": "🧠",',
    '  "title": "...",',
    '  "bodyBlocks": [',
    '    { "type": "paragraph", "text": "..." },',
    '    { "type": "list", "items": ["...", "..."] },',
    '    { "type": "storyBeat", "text": "..." },',
    '    { "type": "punchline", "text": "..." },',
    '    { "type": "takeaway", "text": "..." }',
    '  ],',
    '  "cta": {',
    '    "text": "..."',
    '  },',
    '  "imageBrief": {',
    '    "concept": "...",',
    '    "style": "..."',
    '  },',
    '  "sourceTweetId": "...",',
    '  "configVersion": "..."',
    '}',
    'Используй только допустимые block types для выбранного архетипа',
    'Не добавляй лишние поля',
  ].join('\n');
}

export function buildSystemPrompt(args: { config: RewriteConfig; archetype: RewriteArchetype }) {
  return [
    'Ты — редактор Telegram-канала про фронтенд-разработку. Преврати твит другого автора в структурированный JSON для Telegram-поста.',
    '',
    `Версия rewrite-конфига: ${args.config.configVersion}`,
    '',
    buildVoiceSection(args.config),
    '',
    buildInvariantSection(args.config),
    '',
    buildArchetypeSection(args.archetype),
    '',
    buildOutputContractSection(),
  ].join('\n');
}
