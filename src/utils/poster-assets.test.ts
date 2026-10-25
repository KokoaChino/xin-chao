import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPosterAssetCache, planPosterAssets, preparePosterAssets, PosterAssetsError, ASSET_CONCURRENCY, ASSET_TIMEOUT_MS, type PosterAssetPlan, type PosterProgress } from './poster-assets';
import type { CharacterSummary } from '../types';

const verify = vi.fn(async () => ({ width: 500, height: 500 }));
const response = () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Type': 'image/png', 'Content-Length': '4' } });
const plan = (count: number): PosterAssetPlan => ({
  tasks: Array.from({ length: count }, (_, index) => ({ label: `角色${index} · 头像`, url: `https://images.example/${index}.png` })),
  rows: [], unavailableBackgrounds: [],
});
afterEach(() => { clearPosterAssetCache(); vi.useRealTimers(); verify.mockClear(); });

describe('严格海报素材加载', () => {
  it('只选指定的主头像，不读取圆形备用图；来源无海报立绘会单独列出', () => {
    const character = { id: '1', displayName: '菲比', name: '菲比', avatar: { url: 'https://images.example/square.png', fallbackUrl: 'https://images.example/round.png' }, poster: null } as CharacterSummary;
    const result = planPosterAssets([{ id: '1', character, variants: [character] }], 1920);
    expect(result.tasks).toEqual([{ url: character.avatar.url, label: '菲比 · 头像' }]);
    expect(result.rows[0].background).toBeNull();
    expect(result.unavailableBackgrounds).toEqual(['菲比']);
    expect(JSON.stringify(result)).not.toContain('round.png');
    expect(() => planPosterAssets([{ id: '1', character: { ...character, avatar: { url: '' } }, variants: [] }], 1920)).toThrow(PosterAssetsError);
  });

  it('4并发有界预加载，去重成功资源并复用缓存，完成前逐项提供进度', async () => {
    let current = 0, peak = 0;
    const fetcher = vi.fn(async () => {
      peak = Math.max(peak, ++current);
      await new Promise(resolve => setTimeout(resolve, 3));
      current--; return response();
    });
    const updates: PosterProgress[] = [];
    const result = await preparePosterAssets(plan(9), progress => updates.push(progress), undefined, { fetcher, verify });
    expect(peak).toBe(ASSET_CONCURRENCY);
    expect(result.size).toBe(9);
    expect(updates.some(progress => progress.activeAssets.length === 4)).toBe(true);
    expect(updates.at(-1)).toMatchObject({ completed: 9, total: 9, activeAssets: [] });
    expect(fetcher.mock.calls).toHaveLength(9);
    await preparePosterAssets(plan(9), undefined, undefined, { fetcher, verify });
    expect(fetcher.mock.calls).toHaveLength(9);
  });

  it('失败只重试同一图片，全部素材校验成功才返回', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(response());
    const updates: PosterProgress[] = [];
    const result = await preparePosterAssets(plan(1), progress => updates.push(progress), undefined, { fetcher, verify, retryDelays: [0, 0] });
    expect(result.size).toBe(1);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(Array(3).fill(plan(1).tasks[0].url));
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer', cache: 'default' });
    expect(fetcher.mock.calls[1][1]?.cache).toBe('reload');
    expect(updates.some(progress => progress.activeAssets.some(asset => asset.state === 'retrying'))).toBe(true);
  });

  it('允许超过原12秒的图片继续加载，显示等待时间与接收进度', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 20_000)); return response(); });
    const updates: PosterProgress[] = [];
    const pending = preparePosterAssets(plan(1), progress => updates.push(progress), undefined, { fetcher, verify });
    await vi.advanceTimersByTimeAsync(19_000);
    expect(updates.at(-1)?.activeAssets[0].elapsedSeconds).toBe(19);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).size).toBe(1);
    expect(ASSET_TIMEOUT_MS).toBe(120_000);
  });

  it('超时耗尽重试后报告具体素材，不返回可导出的残缺结果', async () => {
    const fetcher = vi.fn<typeof fetch>((_, options) => new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })));
    let error: unknown;
    try { await preparePosterAssets(plan(1), undefined, undefined, { fetcher, verify, timeoutMs: 5, attempts: 2, retryDelays: [0] }); }
    catch (reason) { error = reason; }
    expect(error).toBeInstanceOf(PosterAssetsError);
    expect((error as PosterAssetsError).failures).toEqual([expect.objectContaining({ label: '角色0 · 头像', attempts: 2, reason: expect.stringContaining('仍未完成') })]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([403, 404])('HTTP %s不无意义重试，立即停止排队任务，已成功素材可复用', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response('', { status })).mockImplementation(async () => response());
    let error: unknown;
    try { await preparePosterAssets(plan(3), undefined, undefined, { fetcher, verify, concurrency: 1 }); } catch (reason) { error = reason; }
    expect((error as PosterAssetsError).failures).toHaveLength(1);
    expect((error as PosterAssetsError).failures[0].reason).toBe(`图片来源返回 HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await preparePosterAssets(plan(3), undefined, undefined, { fetcher, verify, concurrency: 1 })).size).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('最终失败会取消其他在途请求，不继续等待无法导出的残缺任务', async () => {
    let aborted = 0;
    const fetcher = vi.fn<typeof fetch>((input, options) => String(input).endsWith('/0.png')
      ? Promise.resolve(new Response('', { status: 404 }))
      : new Promise((_, reject) => options?.signal?.addEventListener('abort', () => { aborted++; reject(options.signal?.reason); }, { once: true })));
    await expect(preparePosterAssets(plan(10), undefined, undefined, { fetcher, verify })).rejects.toBeInstanceOf(PosterAssetsError);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(aborted).toBe(3);
  });

  it('损坏图片不能通过校验，也不会被缓存为可用头像', async () => {
    const fetcher = vi.fn(async () => response()), badImage = vi.fn(async () => { throw new Error('图片解码失败'); });
    await expect(preparePosterAssets(plan(1), undefined, undefined, { fetcher, verify: badImage, attempts: 1 })).rejects.toThrow(PosterAssetsError);
    await preparePosterAssets(plan(1), undefined, undefined, { fetcher, verify });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('取消立即终止在途请求，不启动排队素材，也不记录为用户可见失败', async () => {
    const controller = new AbortController();
    let aborted = 0;
    const fetcher = vi.fn<typeof fetch>((_, options) => new Promise((_, reject) => options?.signal?.addEventListener('abort', () => { aborted++; reject(options.signal?.reason); }, { once: true })));
    const pending = preparePosterAssets(plan(10), undefined, controller.signal, { fetcher, verify });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(aborted).toBe(4);
  });
});
