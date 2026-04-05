export type PostImageBrief = {
  concept: string;
  style: string;
};

export type StructuredTelegramPost = {
  titleEmoji: string;
  title: string;
  lead: string;
  bullets: string[];
  takeaway: string;
  question: string;
  imageBrief: PostImageBrief;
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

function normalizeBullets(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 5);
}

function normalizeQuestion(value: string) {
  const trimmed = value.trim();
  if (trimmed.endsWith('?')) return trimmed;
  return `${trimmed}?`;
}

function normalizeTitle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
}

function normalizeEmoji(value: string) {
  return value.trim() || '🧠';
}

function normalizeStructuredPost(input: {
  titleEmoji: string;
  title: string;
  lead: string;
  bullets: string[];
  takeaway: string;
  question: string;
  imageBrief: PostImageBrief;
}): StructuredTelegramPost {
  return {
    titleEmoji: normalizeEmoji(input.titleEmoji),
    title: normalizeTitle(input.title),
    lead: input.lead.trim(),
    bullets: input.bullets,
    takeaway: input.takeaway.trim(),
    question: normalizeQuestion(input.question),
    imageBrief: {
      concept: input.imageBrief.concept.trim(),
      style: input.imageBrief.style.trim(),
    },
  };
}

export function parseStructuredTelegramPost(raw: string): ParseStructuredPostResult {
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

  const titleEmoji = asTrimmedString(parsed.titleEmoji);
  if (!titleEmoji) errors.push('titleEmoji is required');

  const title = asTrimmedString(parsed.title);
  if (!title) errors.push('title is required');

  const lead = asTrimmedString(parsed.lead);
  if (!lead) errors.push('lead is required');

  const takeaway = asTrimmedString(parsed.takeaway);
  if (!takeaway) errors.push('takeaway is required');

  const question = asTrimmedString(parsed.question);
  if (!question) errors.push('question is required');

  const bullets = normalizeBullets(parsed.bullets);
  if (Array.isArray(parsed.bullets) && parsed.bullets.length > 5) {
    errors.push('bullets must contain at most 5 items');
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

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const safeTitleEmoji = titleEmoji ?? '🧠';
  const safeTitle = title ?? '';
  const safeLead = lead ?? '';
  const safeTakeaway = takeaway ?? '';
  const safeQuestion = question ?? '';
  const safeImageBriefConcept = imageBriefConcept ?? '';
  const safeImageBriefStyle = imageBriefStyle ?? '';

  return {
    ok: true,
    value: normalizeStructuredPost({
      titleEmoji: safeTitleEmoji,
      title: safeTitle,
      lead: safeLead,
      bullets,
      takeaway: safeTakeaway,
      question: safeQuestion,
      imageBrief: {
        concept: safeImageBriefConcept,
        style: safeImageBriefStyle,
      },
    }),
  };
}
