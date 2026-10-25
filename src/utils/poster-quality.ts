export const POSTER_WIDTHS = [1920, 1600, 1280, 1080, 720] as const;
export type PosterWidth = typeof POSTER_WIDTHS[number];
export const MAX_POSTER_CHARACTERS = 100;

export class PosterResourceError extends Error {
  constructor(message: string) { super(message); this.name = 'PosterResourceError'; }
}

function recoverable(error: unknown): boolean {
  if (error instanceof Error && ['AbortError', 'SecurityError', 'NotSupportedError', 'TypeError'].includes(error.name)) return false;
  return error instanceof PosterResourceError || (error instanceof Error && [
    'RangeError', 'QuotaExceededError', 'IndexSizeError', 'InvalidStateError', 'OutOfMemoryError', 'NS_ERROR_FAILURE',
  ].includes(error.name)) || (error instanceof Error && /out of memory|memory allocation|allocation failed|failed to allocate|insufficient memory/i.test(error.message));
}

export async function withPosterQuality<T>(
  render: (width: PosterWidth) => Promise<T>, signal?: AbortSignal, onAttempt?: (width: PosterWidth) => void,
): Promise<T> {
  for (const width of POSTER_WIDTHS) {
    signal?.throwIfAborted();
    onAttempt?.(width);
    try { return await render(width); }
    catch (error) {
      signal?.throwIfAborted();
      if (!recoverable(error)) throw error;
      // Let the failed attempt release its surfaces before allocating the next tier.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  throw new Error('当前设备可用内存不足，海报生成失败。请关闭其他标签页后重试。');
}
