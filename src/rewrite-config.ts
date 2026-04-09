export type ArchetypeId =
  | 'contrarian-take'
  | 'mini-list'
  | 'problem-insight'
  | 'micro-story-takeaway'
  | 'plain-punchline';

export type LengthBand = 'short' | 'medium' | 'long';

export type RhetoricalDevice =
  | 'hook'
  | 'list'
  | 'contrast'
  | 'question-ending'
  | 'story-beat'
  | 'punchline'
  | 'practical-takeaway';

export type BodyBlockType = 'paragraph' | 'list' | 'storyBeat' | 'punchline' | 'takeaway';

export type RewriteArchetype = {
  id: ArchetypeId;
  label: string;
  purpose: string;
  lengthBand: LengthBand;
  allowedBlockTypes: BodyBlockType[];
  structuralContract: string[];
  allowedDevices: RhetoricalDevice[];
  disallowedDevices: RhetoricalDevice[];
};

export type RewriteConfig = {
  configVersion: string;
  voiceRules: string[];
  rewriteInvariants: string[];
  archetypes: RewriteArchetype[];
};

export const rewriteConfig = {
  configVersion: 'v2',
  voiceRules: [
    'Язык: русский',
    'Тон: живой, разговорный, уверенный, без канцелярита',
    'Пиши как умный практикующий фронтендер, а не как мотиватор или редактор-формалист',
    'Конкретика важнее абстракции',
    'Не перегружай текст вводными конструкциями',
    'Избегай фальшивой категоричности и напускной драматизации',
    'Голос должен оставаться единым во всех архетипах, меняется упаковка, а не персона',
  ],
  rewriteInvariants: [
    'Не искажай факты из исходного твита',
    'Не меняй позицию автора на противоположную или существенно иную',
    'Не выдумывай личный опыт, детали, кейсы, цифры или причины, которых нет в твите',
    'Разрешено добавлять риторическую упаковку: hook, framing, contrast, вопрос в конце, короткий вывод',
    'Риторическая упаковка не должна добавлять новые содержательные утверждения',
    'Если в тексте есть упоминание вида @username, оставляй его как plain text @username',
    'Не используй Markdown, HTML или другую разметку внутри JSON-строк',
    'Все строковые поля ответа должны быть plain text only',
    'Заголовок должен быть коротким, цепляющим и начинаться с заглавной буквы',
    'titleEmoji обязателен: ровно один подходящий эмодзи для заголовка',
    'bodyBlocks должны строго соответствовать выбранному архетипу и его allowedBlockTypes',
    'bodyBlocks должен быть непустым массивом из 1-4 блоков',
    'cta.text, если присутствует, должен быть одним коротким вопросом или мягким призывом к обсуждению',
    'imageBrief.concept и imageBrief.style обязательны и должны опираться только на содержание поста',
    'sourceTweetId должен совпадать с идентификатором исходного твита из контекста',
    'configVersion должен совпадать с версией rewrite-конфига из system prompt',
    'Старайся уложить полезный контент примерно в 850 символов',
    'Верни только JSON без пояснений и без code fences',
  ],
  archetypes: [
    {
      id: 'contrarian-take',
      label: 'Contrarian take',
      purpose: 'Подать мысль как сильный тезис с разворотом ожидания',
      lengthBand: 'medium',
      allowedBlockTypes: ['paragraph', 'punchline', 'takeaway'],
      structuralContract: [
        'Первый body block должен быстро ломать ожидание или формулировать острый тезис',
        'Допускается 1-2 paragraph или punchline блока до финального takeaway',
        'Финальный takeaway должен заземлить тезис в практику фронтенд-разработки',
        'CTA, если есть, должен продолжать спор или приглашать к позиции',
      ],
      allowedDevices: ['hook', 'contrast', 'question-ending', 'practical-takeaway', 'punchline'],
      disallowedDevices: ['list', 'story-beat'],
    },
    {
      id: 'mini-list',
      label: 'Mini-list',
      purpose: 'Упаковать мысль в короткий список из нескольких пунктов',
      lengthBand: 'medium',
      allowedBlockTypes: ['paragraph', 'list', 'takeaway'],
      structuralContract: [
        'Начни с короткого paragraph блока, который называет тему списка',
        'Должен быть ровно один list block с 2-4 короткими пунктами',
        'Финальный takeaway должен собрать список в один практический вывод',
        'CTA может спрашивать про похожий опыт или альтернативы',
      ],
      allowedDevices: ['hook', 'list', 'question-ending', 'practical-takeaway'],
      disallowedDevices: ['story-beat'],
    },
    {
      id: 'problem-insight',
      label: 'Problem to insight',
      purpose: 'Показать проблему, наблюдение и вывод',
      lengthBand: 'medium',
      allowedBlockTypes: ['paragraph', 'takeaway', 'punchline'],
      structuralContract: [
        'Первый paragraph block должен обозначить проблему или напряжение',
        'Следующий block должен раскрыть наблюдение или разворот мысли',
        'Финальный takeaway должен быть явным insight из проблемы',
        'CTA должен открывать обсуждение решения или trade-off',
      ],
      allowedDevices: ['hook', 'contrast', 'question-ending', 'practical-takeaway'],
      disallowedDevices: ['story-beat', 'list'],
    },
    {
      id: 'micro-story-takeaway',
      label: 'Micro-story to takeaway',
      purpose: 'Превратить мысль в короткий эпизод с выводом',
      lengthBand: 'long',
      allowedBlockTypes: ['storyBeat', 'paragraph', 'takeaway'],
      structuralContract: [
        'Первый block должен быть storyBeat и звучать как короткий момент, эпизод или наблюдаемая сцена',
        'Допускается еще один paragraph block для разворота мысли',
        'Финальный takeaway должен быть явным смыслом истории, а не повтором эпизода',
        'CTA должен переводить историю в практическое обсуждение',
      ],
      allowedDevices: ['hook', 'story-beat', 'question-ending', 'practical-takeaway'],
      disallowedDevices: ['list'],
    },
    {
      id: 'plain-punchline',
      label: 'Plain punchline',
      purpose: 'Оставить одну компактную мысль без лишних секций и украшений',
      lengthBand: 'short',
      allowedBlockTypes: ['paragraph', 'punchline', 'takeaway'],
      structuralContract: [
        'Используй 1-2 коротких body blocks максимум',
        'Основная мысль должна прозвучать сразу и без раскачки',
        'Если есть takeaway, он должен быть сжатым и чуть более прикладным, чем основной тезис',
        'CTA должен быть очень коротким или отсутствовать',
      ],
      allowedDevices: ['hook', 'punchline', 'question-ending', 'practical-takeaway'],
      disallowedDevices: ['list', 'story-beat'],
    },
  ],
} satisfies RewriteConfig;
