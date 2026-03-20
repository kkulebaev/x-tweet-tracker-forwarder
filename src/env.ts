export function mustEnv(key: string): string {
  const v = (process.env[key] ?? '').trim();
  if (!v) throw new Error(`${key} is required`);
  return v;
}

export function envInt(key: string, def: number): number {
  const raw = (process.env[key] ?? '').trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return n;
}
