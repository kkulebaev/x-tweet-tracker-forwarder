import Redis from 'ioredis';
import { mustEnv } from './env.js';

export const STREAM_KEY = 'voyager:tweets';
export const GROUP = 'forwarder';

let client: Redis | null = null;

export function redis() {
  if (!client) {
    client = new Redis(mustEnv('REDIS_URL'), {
      maxRetriesPerRequest: 2,
    });
    client.on('error', (e) => {
      console.warn('redis error', String((e as any)?.message ?? e));
    });
  }
  return client;
}

export async function ensureGroup() {
  const r = redis();
  try {
    // Create consumer group at the end ($) so we only process new events.
    await r.xgroup('CREATE', STREAM_KEY, GROUP, '$', 'MKSTREAM');
  } catch (e) {
    const msg = String((e as any)?.message ?? e);
    // BUSYGROUP Consumer Group name already exists
    if (msg.includes('BUSYGROUP')) return;
    throw e;
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

function parseEntry(entry: any) {
  const [id, kv] = entry;
  const obj: Record<string, string> = {};
  for (let i = 0; i < kv.length; i += 2) obj[String(kv[i])] = String(kv[i + 1]);

  const payloadRaw = obj.payload;
  if (!payloadRaw) {
    return { id: String(id), payload: null as any };
  }

  let payload: TweetEventPayload;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    payload = { type: 'unknown', tweetId: obj.tweetId ?? '', url: '', text: payloadRaw, xUsername: null, createdAt: '' };
  }

  return { id: String(id), payload };
}

export async function autoClaimPending(args: { consumer: string; minIdleMs: number; count?: number }) {
  const r = redis();
  // XAUTOCLAIM key group consumer min-idle-time start [COUNT count]
  // We start from 0-0 to claim the oldest pending.
  const count = Math.min(Math.max(args.count ?? 1, 1), 20);

  const resp = (await (r as any).xautoclaim(
    STREAM_KEY,
    GROUP,
    args.consumer,
    args.minIdleMs,
    '0-0',
    'COUNT',
    count,
  )) as any;

  // resp = [nextStartId, entries, deletedIds]
  if (!resp || !resp[1] || resp[1].length === 0) return [];

  return resp[1].map(parseEntry);
}

export async function readOneNew(consumer: string, blockMs: number) {
  const r = redis();
  const resp = (await r.xreadgroup(
    'GROUP',
    GROUP,
    consumer,
    'COUNT',
    1,
    'BLOCK',
    blockMs,
    'STREAMS',
    STREAM_KEY,
    '>',
  )) as any;

  if (!resp) return null;

  const [[, entries]] = resp;
  if (!entries?.length) return null;

  return parseEntry(entries[0]);
}

export async function ack(id: string) {
  const r = redis();
  await r.xack(STREAM_KEY, GROUP, id);
}

export async function closeRedis() {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    // ignore
  } finally {
    try {
      client.disconnect();
    } catch {
      // ignore
    }
    client = null;
  }
}
