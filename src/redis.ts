import Redis from 'ioredis';
import { mustEnv } from './env.js';
import { logger, serializeError } from './logger.js';

export const STREAM_KEY = 'voyager:tweets';
export const GROUP = 'forwarder';

let client: Redis | null = null;

export function redis() {
  if (!client) {
    client = new Redis(mustEnv('REDIS_URL'), {
      maxRetriesPerRequest: 2,
    });
    client.on('error', (error) => {
      logger.warn('redis_client_error', {
        error: serializeError(error),
      });
    });
    logger.info('redis_client_created', {
      streamKey: STREAM_KEY,
      group: GROUP,
    });
  }
  return client;
}

export async function ensureGroup() {
  const r = redis();
  try {
    await r.xgroup('CREATE', STREAM_KEY, GROUP, '$', 'MKSTREAM');
    logger.info('redis_group_created', {
      streamKey: STREAM_KEY,
      group: GROUP,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('BUSYGROUP')) {
      logger.info('redis_group_exists', {
        streamKey: STREAM_KEY,
        group: GROUP,
      });
      return;
    }
    logger.error('redis_group_create_failed', {
      streamKey: STREAM_KEY,
      group: GROUP,
      error: serializeError(error),
    });
    throw error;
  }
}

export type TweetEventPayload = {
  type: string;
  tweetId: string;
  xUsername: string | null;
  url: string;
  text: string;
  createdAt: string;
};

type StreamEntry = [id: string, kv: string[]];

type XReadGroupResponse = [stream: string, entries: StreamEntry[]][];

type AutoClaimResponse = [nextStartId: string, entries: StreamEntry[], deletedIds: string[]];

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'string');
}

function isStreamEntry(x: unknown): x is StreamEntry {
  return Array.isArray(x) && typeof x[0] === 'string' && isStringArray(x[1]);
}

function isXReadGroupResponse(x: unknown): x is XReadGroupResponse {
  return (
    Array.isArray(x) &&
    x.every(
      (row) => Array.isArray(row) && typeof row[0] === 'string' && Array.isArray(row[1]) && row[1].every(isStreamEntry),
    )
  );
}

function isAutoClaimResponse(x: unknown): x is AutoClaimResponse {
  return Array.isArray(x) && typeof x[0] === 'string' && Array.isArray(x[1]) && x[1].every(isStreamEntry) && Array.isArray(x[2]);
}

function parseEntry(entry: StreamEntry) {
  const [id, kv] = entry;
  const obj: Record<string, string> = {};
  for (let i = 0; i < kv.length; i += 2) obj[kv[i]!] = kv[i + 1]!;

  const payloadRaw = obj.payload;
  if (!payloadRaw) {
    return { id, payload: null };
  }

  let payload: TweetEventPayload;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    payload = { type: 'unknown', tweetId: obj.tweetId ?? '', url: '', text: payloadRaw, xUsername: null, createdAt: '' };
    logger.warn('redis_payload_json_parse_failed', {
      streamId: id,
      tweetId: payload.tweetId,
    });
  }

  return { id, payload };
}

export async function autoClaimPending(args: { consumer: string; minIdleMs: number; count?: number }) {
  const r = redis();
  const count = Math.min(Math.max(args.count ?? 1, 1), 20);

  const resp: unknown = await r.call(
    'XAUTOCLAIM',
    STREAM_KEY,
    GROUP,
    args.consumer,
    String(args.minIdleMs),
    '0-0',
    'COUNT',
    String(count),
  );

  if (!isAutoClaimResponse(resp)) {
    logger.warn('redis_autoclaim_response_invalid', {
      consumer: args.consumer,
    });
    return [];
  }
  if (resp[1].length === 0) return [];

  logger.info('redis_autoclaim_succeeded', {
    consumer: args.consumer,
    claimedCount: resp[1].length,
  });

  return resp[1].map(parseEntry);
}

export async function readOneNew(consumer: string, blockMs: number) {
  const r = redis();

  const resp: unknown = await r.call(
    'XREADGROUP',
    'GROUP',
    GROUP,
    consumer,
    'COUNT',
    '1',
    'BLOCK',
    String(blockMs),
    'STREAMS',
    STREAM_KEY,
    '>',
  );

  if (!isXReadGroupResponse(resp)) {
    logger.warn('redis_readgroup_response_invalid', {
      consumer,
      blockMs,
    });
    return null;
  }

  const entries = resp[0]?.[1];
  if (!entries?.length) return null;

  logger.info('redis_readgroup_succeeded', {
    consumer,
    entryCount: entries.length,
  });

  return parseEntry(entries[0]);
}

export async function ack(id: string) {
  const r = redis();
  await r.xack(STREAM_KEY, GROUP, id);
  logger.info('redis_xack_succeeded', {
    streamId: id,
  });
}

export async function closeRedis() {
  if (!client) return;
  try {
    await client.quit();
    logger.info('redis_quit_succeeded');
  } catch (error) {
    logger.warn('redis_quit_failed', {
      error: serializeError(error),
    });
  } finally {
    try {
      client.disconnect();
      logger.info('redis_disconnect_succeeded');
    } catch (error) {
      logger.warn('redis_disconnect_failed', {
        error: serializeError(error),
      });
    }
    client = null;
  }
}
