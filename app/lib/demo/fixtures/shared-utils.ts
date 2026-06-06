export const BASE_NOW = Date.now();

export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function pick<T>(rnd: () => number, items: T[]): T {
  return items[Math.floor(rnd() * items.length)] as T;
}

export function int(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}

export function isoFromNow(msAgo: number): string {
  return new Date(BASE_NOW - msAgo).toISOString();
}

export function isoInFuture(msAhead: number): string {
  return new Date(BASE_NOW + msAhead).toISOString();
}

export function stableId(prefix: string, n: number): string {
  return `${prefix}_${String(n).padStart(3, '0')}`;
}

export const DEMO_ORG = 'org_demo';

const MS_MINUTE = 60 * 1000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

export { MS_MINUTE, MS_HOUR, MS_DAY };
