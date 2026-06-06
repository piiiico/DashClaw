export const HIGHLIGHTS_VERSION = '2026-02-15-major-v2';
export const HIGHLIGHTS_DISMISS_KEY = 'dashclaw_capability_highlights_dismissed_version';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function isHighlightsDismissed(storage: StorageLike | undefined | null = globalThis?.localStorage): boolean {
  try {
    return Boolean(storage) && storage!.getItem(HIGHLIGHTS_DISMISS_KEY) === HIGHLIGHTS_VERSION;
  } catch {
    return false;
  }
}

export function dismissHighlights(storage: StorageLike | undefined | null = globalThis?.localStorage): void {
  try {
    if (storage) {
      storage.setItem(HIGHLIGHTS_DISMISS_KEY, HIGHLIGHTS_VERSION);
    }
  } catch {
    // ignore storage errors
  }
}
