type LogLevel = 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
};

function timestamp() {
  return new Date().toISOString();
}

function serializeUnknown(value: unknown): unknown {
  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map(serializeUnknown);
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, serializeUnknown(nestedValue)]));
  }

  return value;
}

function serializeContext(context: LogContext) {
  return Object.fromEntries(Object.entries(context).map(([key, value]) => [key, serializeUnknown(value)]));
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const serialized: SerializedError = {
      name: error.name,
      message: error.message,
    };

    if (error.stack) {
      serialized.stack = error.stack;
    }

    const errorWithCause = error as Error & { cause?: unknown };
    if ('cause' in errorWithCause && errorWithCause.cause !== undefined) {
      serialized.cause = serializeUnknown(errorWithCause.cause);
    }

    return serialized;
  }

  return {
    name: 'NonError',
    message: String(error),
  };
}

function write(level: LogLevel, event: string, context: LogContext = {}) {
  const payload = {
    ts: timestamp(),
    level,
    event,
    ...serializeContext(context),
  };

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const logger = {
  info(event: string, context?: LogContext) {
    write('info', event, context);
  },
  warn(event: string, context?: LogContext) {
    write('warn', event, context);
  },
  error(event: string, context?: LogContext) {
    write('error', event, context);
  },
};
