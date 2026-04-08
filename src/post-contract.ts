export type PostImageBrief = {
  concept: string;
  style: string;
};

export type PostCta = {
  text: string;
};

export type ParagraphBlock = {
  type: 'paragraph';
  text: string;
};

export type ListBlock = {
  type: 'list';
  items: string[];
};

export type StoryBeatBlock = {
  type: 'storyBeat';
  text: string;
};

export type PunchlineBlock = {
  type: 'punchline';
  text: string;
};

export type TakeawayBlock = {
  type: 'takeaway';
  text: string;
};

export type PostBodyBlock = ParagraphBlock | ListBlock | StoryBeatBlock | PunchlineBlock | TakeawayBlock;

export type StructuredTelegramPost = {
  archetype: string;
  titleEmoji: string;
  title: string;
  bodyBlocks: PostBodyBlock[];
  cta: PostCta | null;
  imageBrief: PostImageBrief;
  sourceTweetId: string;
  configVersion: string;
};

export type ParseStructuredPostResult =
  | { ok: true; value: StructuredTelegramPost }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asTrimmedString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTitle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
}

function normalizeEmoji(value: string) {
  return value.trim() || '🧠';
}

function normalizeCta(value: unknown) {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;

  const text = asTrimmedString(value.text);
  if (!text) return null;

  return { text } satisfies PostCta;
}

function normalizeListItems(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 5);
}

function normalizeBodyBlock(value: unknown): PostBodyBlock | null {
  if (!isRecord(value)) return null;

  const type = asTrimmedString(value.type);
  if (!type) return null;

  if (type === 'list') {
    const items = normalizeListItems(value.items);
    if (items.length === 0) return null;
    return { type: 'list', items };
  }

  const text = asTrimmedString(value.text);
  if (!text) return null;

  if (type === 'paragraph') return { type: 'paragraph', text };
  if (type === 'storyBeat') return { type: 'storyBeat', text };
  if (type === 'punchline') return { type: 'punchline', text };
  if (type === 'takeaway') return { type: 'takeaway', text };

  return null;
}

function normalizeBodyBlocks(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => normalizeBodyBlock(item))
    .filter((item): item is PostBodyBlock => item !== null)
    .slice(0, 4);
}

function normalizeStructuredPost(input: {
  archetype: string;
  titleEmoji: string;
  title: string;
  bodyBlocks: PostBodyBlock[];
  cta: PostCta | null;
  imageBrief: PostImageBrief;
  sourceTweetId: string;
  configVersion: string;
}): StructuredTelegramPost {
  return {
    archetype: input.archetype.trim(),
    titleEmoji: normalizeEmoji(input.titleEmoji),
    title: normalizeTitle(input.title),
    bodyBlocks: input.bodyBlocks,
    cta: input.cta,
    imageBrief: {
      concept: input.imageBrief.concept.trim(),
      style: input.imageBrief.style.trim(),
    },
    sourceTweetId: input.sourceTweetId.trim(),
    configVersion: input.configVersion.trim(),
  };
}

export function parseStructuredTelegramPost(
  raw: string,
  expected?: { archetype?: string; configVersion?: string; sourceTweetId?: string; allowedBlockTypes?: string[] },
): ParseStructuredPostResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['response is not valid JSON'] };
  }

  if (!isRecord(parsed)) {
    return { ok: false, errors: ['response root must be an object'] };
  }

  const errors: string[] = [];

  const archetype = asTrimmedString(parsed.archetype);
  if (!archetype) errors.push('archetype is required');
  if (expected?.archetype && archetype && archetype !== expected.archetype) {
    errors.push(`archetype must equal ${expected.archetype}`);
  }

  const titleEmoji = asTrimmedString(parsed.titleEmoji);
  if (!titleEmoji) errors.push('titleEmoji is required');

  const title = asTrimmedString(parsed.title);
  if (!title) errors.push('title is required');

  const bodyBlocks = normalizeBodyBlocks(parsed.bodyBlocks);
  if (bodyBlocks.length === 0) {
    errors.push('bodyBlocks must contain at least 1 valid block');
  }
  if (Array.isArray(parsed.bodyBlocks) && parsed.bodyBlocks.length > 4) {
    errors.push('bodyBlocks must contain at most 4 items');
  }
  if (expected?.allowedBlockTypes) {
    const invalidBlock = bodyBlocks.find((block) => !expected.allowedBlockTypes?.includes(block.type));
    if (invalidBlock) {
      errors.push(`bodyBlocks contains disallowed block type: ${invalidBlock.type}`);
    }
  }

  const cta = normalizeCta(parsed.cta);
  if (parsed.cta !== undefined && parsed.cta !== null && !cta) {
    errors.push('cta must be null or an object with non-empty text');
  }

  const imageBriefRaw = parsed.imageBrief;
  if (!isRecord(imageBriefRaw)) {
    errors.push('imageBrief is required');
  }

  const imageBriefConcept = isRecord(imageBriefRaw)
    ? asTrimmedString(imageBriefRaw.concept)
    : null;
  if (!imageBriefConcept) errors.push('imageBrief.concept is required');

  const imageBriefStyle = isRecord(imageBriefRaw)
    ? asTrimmedString(imageBriefRaw.style)
    : null;
  if (!imageBriefStyle) errors.push('imageBrief.style is required');

  const sourceTweetId = asTrimmedString(parsed.sourceTweetId);
  if (!sourceTweetId) errors.push('sourceTweetId is required');
  if (expected?.sourceTweetId && sourceTweetId && sourceTweetId !== expected.sourceTweetId) {
    errors.push(`sourceTweetId must equal ${expected.sourceTweetId}`);
  }

  const configVersion = asTrimmedString(parsed.configVersion);
  if (!configVersion) errors.push('configVersion is required');
  if (expected?.configVersion && configVersion && configVersion !== expected.configVersion) {
    errors.push(`configVersion must equal ${expected.configVersion}`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const safeArchetype = archetype ?? '';
  const safeTitleEmoji = titleEmoji ?? '🧠';
  const safeTitle = title ?? '';
  const safeImageBriefConcept = imageBriefConcept ?? '';
  const safeImageBriefStyle = imageBriefStyle ?? '';
  const safeSourceTweetId = sourceTweetId ?? '';
  const safeConfigVersion = configVersion ?? '';

  return {
    ok: true,
    value: normalizeStructuredPost({
      archetype: safeArchetype,
      titleEmoji: safeTitleEmoji,
      title: safeTitle,
      bodyBlocks,
      cta,
      imageBrief: {
        concept: safeImageBriefConcept,
        style: safeImageBriefStyle,
      },
      sourceTweetId: safeSourceTweetId,
      configVersion: safeConfigVersion,
    }),
  };
}
