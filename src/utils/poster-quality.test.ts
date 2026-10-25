import { describe, expect, it, vi } from 'vitest';
import { PosterResourceError, POSTER_WIDTHS, withPosterQuality, type PosterWidth } from './poster-quality';

describe('海报自动清晰度回退', () => {
  it('优先1920，成功后不降低清晰度', async () => {
    const render = vi.fn(async (width: PosterWidth) => ({ width })), attempted = vi.fn();
    await expect(withPosterQuality(render, undefined, attempted)).resolves.toEqual({ width: 1920 });
    expect(render).toHaveBeenCalledExactlyOnceWith(1920);
    expect(attempted).toHaveBeenCalledExactlyOnceWith(1920);
  });

  it('失败后按顺序重新生成完整图片，成功就停止', async () => {
    const blob = new Blob(['all 100 characters']);
    const render = vi.fn(async (width: PosterWidth) => {
      if (width > 1280) throw new PosterResourceError('canvas allocation failed');
      return { width, blob, count: 100 };
    });
    await expect(withPosterQuality(render)).resolves.toEqual({ width: 1280, blob, count: 100 });
    expect(render.mock.calls.map(call => call[0])).toEqual([1920, 1600, 1280]);
  });

  it('全部档位资源不足时明确失败，不返回半张海报', async () => {
    const render = vi.fn(async () => { throw new RangeError('allocation failed'); });
    await expect(withPosterQuality(render)).rejects.toThrow('可用内存不足');
    expect(render.mock.calls).toHaveLength(POSTER_WIDTHS.length);
  });

  it.each(['SecurityError', 'AbortError', 'NotSupportedError', 'TypeError'])('%s不触发无效降档', async name => {
    const error = new Error('cannot be fixed by lower resolution'); error.name = name;
    const render = vi.fn(async () => { throw error; });
    await expect(withPosterQuality(render)).rejects.toBe(error);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('跨档重试前检测取消，不再启动下一档', async () => {
    const controller = new AbortController();
    const render = vi.fn(async () => { controller.abort(); throw new PosterResourceError('interrupted'); });
    await expect(withPosterQuality(render, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(render).toHaveBeenCalledTimes(1);
  });
});
