import { describe, expect, it } from 'vitest';
import {
  buildArchetypeSection,
  buildInvariantSection,
  buildOutputContractSection,
  buildSystemPrompt,
  buildVoiceSection,
} from '../src/system-prompt.js';
import { rewriteConfig } from '../src/rewrite-config.js';

describe('system prompt builders', () => {
  it('renders voice and invariant sections as bullet lists', () => {
    expect(buildVoiceSection(rewriteConfig)).toContain('Голос и стиль:');
    expect(buildVoiceSection(rewriteConfig)).toContain(`- ${rewriteConfig.voiceRules[0]}`);

    expect(buildInvariantSection(rewriteConfig)).toContain('Инварианты перепаковки:');
    expect(buildInvariantSection(rewriteConfig)).toContain(`- ${rewriteConfig.rewriteInvariants[0]}`);
  });

  it('renders archetype details including allowed and disallowed devices', () => {
    const section = buildArchetypeSection(rewriteConfig.archetypes[0]);

    expect(section).toContain('Выбранный архетип:');
    expect(section).toContain(`- id: ${rewriteConfig.archetypes[0].id}`);
    expect(section).toContain(`- allowedBlockTypes: ${rewriteConfig.archetypes[0].allowedBlockTypes.join(', ')}`);
    expect(section).toContain(`- allowedDevices: ${rewriteConfig.archetypes[0].allowedDevices.join(', ')}`);
    expect(section).toContain(`- disallowedDevices: ${rewriteConfig.archetypes[0].disallowedDevices.join(', ')}`);
  });

  it('renders the output contract schema', () => {
    const section = buildOutputContractSection();

    expect(section).toContain('Строгая JSON-схема ответа:');
    expect(section).toContain('"bodyBlocks": [');
    expect(section).toContain('Не добавляй лишние поля');
  });

  it('builds the full system prompt from config and archetype', () => {
    const prompt = buildSystemPrompt({
      config: rewriteConfig,
      archetype: rewriteConfig.archetypes[2],
    });

    expect(prompt).toContain('Ты — редактор Telegram-канала про фронтенд-разработку.');
    expect(prompt).toContain(`Версия rewrite-конфига: ${rewriteConfig.configVersion}`);
    expect(prompt).toContain(buildVoiceSection(rewriteConfig));
    expect(prompt).toContain(buildInvariantSection(rewriteConfig));
    expect(prompt).toContain(buildArchetypeSection(rewriteConfig.archetypes[2]));
    expect(prompt).toContain(buildOutputContractSection());
  });
});
