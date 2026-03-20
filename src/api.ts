import { mustEnv } from './env.js';

function normalizeBaseUrl() {
  let base = mustEnv('API_BASE_URL').trim().replace(/\/$/, '');

  const hasScheme = /^https?:\/\//i.test(base);
  if (!hasScheme) {
    const isRailwayInternal = /\.railway\.internal(?::\d+)?$/i.test(base);
    const scheme = isRailwayInternal ? 'http' : 'https';
    base = `${scheme}://${base}`;
  }

  try {
    const u = new URL(base);
    if (u.hostname.toLowerCase().endsWith('.railway.internal') && !u.port) {
      u.port = '8080';
      base = u.toString().replace(/\/$/, '');
    }
  } catch {
    // ignore
  }

  return base;
}

export type ClaimResponse = {
  ok: true;
  tweet: null | {
    tweet_id: string;
    account_id: string;
    created_at: string;
    text: string;
    url: string;
  };
  account?: { xUsername: string } | null;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = normalizeBaseUrl();
  const token = mustEnv('API_TOKEN');

  const res = await fetch(base + path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg = json?.error || json?.message || `${res.status} ${res.statusText}`;
    throw new Error(`API error: ${msg}`);
  }

  return json as T;
}

export async function claimOne() {
  return apiFetch<ClaimResponse>('/admin/tweets/claim', {
    method: 'POST',
    body: JSON.stringify({ limit: 1 }),
  });
}

export async function markSent(tweetId: string) {
  return apiFetch<{ ok: true }>(`/admin/tweets/${encodeURIComponent(tweetId)}/mark-sent`, { method: 'POST' });
}
