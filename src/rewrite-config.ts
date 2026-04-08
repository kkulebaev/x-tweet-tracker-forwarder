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

export type RewriteArchetype = {
  id: ArchetypeId;
  label: string;
  purpose: string;
  lengthBand: LengthBand;
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
  configVersion: 'v1',
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
    'lead должен быть коротким и соответствовать выбранному архетипу',
    'bullets может содержать от 0 до 5 коротких пунктов',
    'takeaway должен быть коротким практическим выводом фронтендера',
    'question должен быть одним коротким вопросом в конце и заканчиваться вопросительным знаком',
    'imageBrief.concept и imageBrief.style обязательны и должны опираться только на содержание поста',
    'Старайся уложить полезный контент примерно в 850 символов',
    'Верни только JSON без пояснений и без code fences',
  ],
  archetypes: [
    {
      id: 'contrarian-take',
      label: 'Contrarian take',
      purpose: 'Подать мысль как сильный тезис с разворотом ожидания',
      lengthBand: 'medium',
      structuralContract: [
        'Начни с плотного hook или тезиса, который ломает ожидание',
        'lead должен содержать основной разворот мысли',
        'bullets лучше не использовать или оставить пустым',
        'takeaway должен заземлить тезис в практику фронтенд-разработки',
        'question должен продолжать спор или приглашать к позиции',
      ],
      allowedDevices: ['hook', 'contrast', 'question-ending', 'practical-takeaway', 'punchline'],
      disallowedDevices: ['list', 'story-beat'],
    },
    {
      id: 'mini-list',
      label: 'Mini-list',
      purpose: 'Упаковать мысль в короткий список из нескольких пунктов',
      lengthBand: 'medium',
      structuralContract: [
        'lead должен быстро назвать тему списка',
        'bullets должен содержать 2-4 коротких пункта',
        'Каждый bullet должен быть самостоятельным и лаконичным',
        'takeaway должен собрать список в один практический вывод',
        'question может спрашивать про похожий опыт или альтернативы',
      ],
      allowedDevices: ['hook', 'list', 'question-ending', 'practical-takeaway'],
      disallowedDevices: ['story-beat'],
    },
    {
      id: 'problem-insight',
      label: 'Problem to insight',
      purpose: 'Показать проблему, наблюдение и вывод',
      lengthBand: 'medium',
      structuralContract: [
        'lead должен обозначить проблему или напряжение',
        'bullets можно не использовать, либо использовать максимум 2 пункта для наблюдений',
        'takeaway должен быть явным insight из проблемы',
        'question должен открывать обсуждение решения или trade-off',
      ],
      allowedDevices: ['hook', 'contrast', 'question-ending', 'practical-takeaway'],
      disallowedDevices: ['story-beat'],
    },
    {
      id: 'micro-story-takeaway',
      label: 'Micro-story to takeaway',
      purpose: 'Превратить мысль в короткий эпизод с выводом',
      lengthBand: 'long',
      structuralContract: [
        'lead должен звучать как короткий эпизод, момент или наблюдаемая сцена',
        'bullets не использовать, если это не критично для ясности',
        'takeaway должен быть явным смыслом истории, а не повтором lead',
        'question должен переводить историю в практическое обсуждение',
      ],
      allowedDevices: ['hook', 'story-beat', 'question-ending', 'practical-takeaway'],
      disallowedDevices: ['list'],
    },
    {
      id: 'plain-punchline',
      label: 'Plain punchline',
      purpose: 'Оставить одну компактную мысль без лишних секций и украшений',
      lengthBand: 'short',
      structuralContract: [
        'lead должен быть коротким и бить прямо в основную мысль',
        'bullets не использовать',
        'takeaway должен быть сжатым и чуть более прикладным, чем lead',
        'question должен быть простым и коротким',
      ],
      allowedDevices: ['hook', 'punchline', 'question-ending', 'practical-takeaway'],
      disallowedDevices: ['list', 'story-beat'],
    },
  ],
} satisfies RewriteConfig;
