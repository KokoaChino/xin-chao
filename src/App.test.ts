import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useCatalog } from './hooks/useCatalog';
import { usePreferences } from './hooks/usePreferences';
import { createDefaultPreferences } from './data/preferences';
import { createRankingPoster, downloadBlob, type RankingPoster, PosterAssetsError, type PosterProgress } from './utils/poster';
import type { CharacterSummary, Preferences } from './types';

vi.mock('./hooks/useCatalog', () => ({ useCatalog: vi.fn() }));
vi.mock('./hooks/usePreferences', () => ({ usePreferences: vi.fn() }));
vi.mock('./utils/poster', async (importOriginal) => ({
  ...await importOriginal<typeof import('./utils/poster')>(),
  createRankingPoster: vi.fn(), downloadBlob: vi.fn(),
}));
vi.mock('./components/RankBoard', () => ({ default: () => null }));
vi.mock('./components/CatalogGrid', () => ({ default: () => null }));
vi.mock('./components/CharacterDetail', () => ({ default: () => null }));

function fixture(id: string): CharacterSummary {
  return {
    id, identityId: id, name: id, displayName: id, romanizedName: id,
    description: '', resonanceName: '', gender: '女', origin: '今州',
    affiliation: '今州', weapon: '迅刀', element: '衍射', releaseVersion: 'V1.0',
    avatar: { url: `https://example.test/${id}.png` }, hero: null, poster: null,
    hasOutfits: false, voiceCount: 0, isPreview: false,
    sourceUrl: `https://wiki.kurobbs.com/mc/item/${id}`, fetchedAt: '2026-10-23T12:00:00Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function posterResult(blob = new Blob(['poster']), previews = [blob]): RankingPoster {
  return { blob, previews: previews.map(blob => ({ blob, width: 960, height: 512 })), width: 1920, height: 56825, unavailableBackgrounds: [] };
}

function progress(completed: number, total: number): PosterProgress { return { phase: 'rendering', completed, total, message: `已绘制 ${completed}/${total} 位共鸣者`, activeAssets: [], unavailableBackgrounds: [] }; }

describe('海报生成会话', () => {
  let root: Root;
  let container: HTMLElement;
  let preferences: Preferences;

  beforeEach(() => {
    const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('HTMLElement', window.HTMLElement);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    container = window.document.getElementById('root')!;
    root = createRoot(container);
    preferences = { ...createDefaultPreferences(), order: ['one'] };
    vi.mocked(useCatalog).mockReturnValue({
      characters: [fixture('one'), fixture('two')], loading: false, error: null,
      sync: { phase: 'idle', completed: 0, total: 0, lastSuccess: null, message: '' },
      refresh: vi.fn(async () => undefined), getCharacter: vi.fn(),
    });
    vi.mocked(usePreferences).mockImplementation(() => ({
      preferences, ready: true, error: null, update: vi.fn(), add: vi.fn(),
      remove: vi.fn(), reorder: vi.fn(), setNote: vi.fn(), setTier: vi.fn(),
      toggleFavorite: vi.fn(), importPreferences: vi.fn(async () => undefined),
      reset: vi.fn(async () => undefined), exportData: vi.fn(() => ''),
    }));
    vi.mocked(createRankingPoster).mockReset();
    vi.mocked(downloadBlob).mockReset();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:poster-${Math.random()}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => root.render(createElement(App)));
  }

  async function clickText(text: string) {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((element) => element.textContent === text);
    if (!button) throw new Error(`Missing button: ${text}`);
    await act(async () => button.click());
  }

  it('点击分享自动生成真实预览，确认点击下载后才下载；关闭时释放预览资源', async () => {
    const task = deferred<RankingPoster>();
    vi.mocked(createRankingPoster).mockReturnValue(task.promise);
    await render();
    await clickText('分享海报');
    expect(container.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('海报预览');
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('正在生成'))!;
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(createRankingPoster).toHaveBeenCalledTimes(1);
    await act(async () => vi.mocked(createRankingPoster).mock.calls[0][2]!(progress(1, 1)));
    expect(button.textContent).toContain('1/1');
    expect(container.querySelector('.poster-loading p')?.textContent).toBe('正在生成预览 1/1');
    const blob = new Blob(['current']);
    await act(async () => task.resolve(posterResult(blob)));
    expect(downloadBlob).not.toHaveBeenCalled();
    const previewUrl = container.querySelector<HTMLImageElement>('.poster-preview img')?.getAttribute('src');
    expect(previewUrl).toMatch(/^blob:poster-/);
    await clickText('下载海报');
    expect(downloadBlob).toHaveBeenCalledExactlyOnceWith(blob, '我的共鸣者XP排行榜.png');
    expect(button.textContent).toBe('分享海报');
    expect(button.disabled).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭弹窗"]')!.click());
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(previewUrl);
  });

  it.each(['resolve', 'reject'] as const)('关闭后的旧任务 %s 不会污染重新打开的预览或结束新任务', async (outcome) => {
    const obsolete = deferred<RankingPoster>(), current = deferred<RankingPoster>();
    vi.mocked(createRankingPoster).mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(current.promise);
    await render(); await clickText('分享海报');
    const oldProgress = vi.mocked(createRankingPoster).mock.calls[0][2]!;
    const oldSignal = vi.mocked(createRankingPoster).mock.calls[0][3]!;
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭弹窗"]')!.click());
    expect(oldSignal.aborted).toBe(true);
    preferences = { ...preferences, order: ['two', 'one'] };
    await render(); await clickText('分享海报');
    expect(vi.mocked(createRankingPoster).mock.calls[1][0].map(entry => entry.id)).toEqual(['two', 'one']);
    await act(async () => {
      vi.mocked(createRankingPoster).mock.calls[1][2]!(progress(1, 2)); oldProgress(progress(99, 99));
      if (outcome === 'resolve') obsolete.resolve(posterResult(new Blob(['obsolete'])));
      else obsolete.reject(new Error('obsolete failure'));
    });
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(container.textContent).toContain('正在生成预览 1/2');
    expect(container.querySelector('.inline-warning')).toBeNull();
    expect(container.querySelector('.poster-preview')).toBeNull();
    const blob = new Blob(['current']);
    await act(async () => current.resolve(posterResult(blob)));
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(blob);
    expect(container.querySelector('.poster-preview img')).not.toBeNull();
    expect(container.querySelector('.poster-loading')).toBeNull();
  });

  it('生成失败后恢复分享按钮并允许重试', async () => {
    vi.mocked(createRankingPoster).mockRejectedValueOnce(new Error('素材加载失败')).mockResolvedValueOnce(posterResult(new Blob(['retry'])));
    await render(); await clickText('分享海报');
    expect(container.textContent).toContain('素材加载失败');
    await clickText('重新生成');
    expect(createRankingPoster).toHaveBeenCalledTimes(2);
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(container.querySelector('.poster-preview img')).not.toBeNull();
  });

  it('长图预览连续拼接多个轻量片段，下载始终只有一张完整PNG', async () => {
    const blob = new Blob(['full-image']), previews = [new Blob(['top']), new Blob(['bottom'])];
    vi.mocked(createRankingPoster).mockResolvedValue(posterResult(blob, previews));
    await render(); await clickText('分享海报');
    expect(container.querySelectorAll('.poster-preview')).toHaveLength(1);
    expect(container.querySelectorAll('.poster-preview img')).toHaveLength(2);
    expect(container.querySelector('.poster-preview img')?.getAttribute('height')).toBe('512');
    expect(container.querySelector('.poster-preview img')?.getAttribute('width')).toBe('960');
    expect(container.querySelector('.poster-resolution')?.textContent).toContain('1920 × 56825');
    expect(container.querySelectorAll('.poster-pages .full-button')).toHaveLength(1);
    expect(downloadBlob).not.toHaveBeenCalled();
    await clickText('下载海报');
    expect(downloadBlob).toHaveBeenCalledExactlyOnceWith(blob, '我的共鸣者XP排行榜.png');
    const urls = vi.mocked(URL.createObjectURL).mock.results.map(result => result.value);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭弹窗"]')!.click());
    expect(urls.every(url => vi.mocked(URL.revokeObjectURL).mock.calls.some(call => call[0] === url))).toBe(true);
  });

  it('素材失败时列出角色、原因和原图，不生成预览或下载入口', async () => {
    const failure = { label: '西格莉卡 · 头像', url: 'https://images.example/sig.png', reason: '图片来源返回 HTTP 404', attempts: 1 };
    vi.mocked(createRankingPoster).mockRejectedValueOnce(new PosterAssetsError([failure]));
    await render(); await clickText('分享海报');
    const error = container.querySelector('[role="alert"]');
    expect(error?.textContent).toContain('西格莉卡 · 头像');
    expect(error?.textContent).toContain('HTTP 404');
    expect(error?.querySelector('a')?.getAttribute('href')).toBe(failure.url);
    expect(container.querySelector('.poster-preview')).toBeNull();
    expect(container.querySelector('.poster-resolution')).toBeNull();
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('展示并发拉取明细、字节数和重试；点击取消终止任务', async () => {
    const pending = deferred<RankingPoster>();
    vi.mocked(createRankingPoster).mockReturnValue(pending.promise);
    await render(); await clickText('分享海报');
    await act(async () => vi.mocked(createRankingPoster).mock.calls[0][2]!({
      phase: 'assets', completed: 12, total: 86, message: '已就绪 12/86 项素材', unavailableBackgrounds: [],
      activeAssets: [{ label: '菲比 · 海报立绘', state: 'fetching', attempt: 1, elapsedSeconds: 18, loadedBytes: 1048576, totalBytes: 2097152 },
        { label: '西格莉卡 · 头像', state: 'retrying', attempt: 2, elapsedSeconds: 3, loadedBytes: 0 }],
    }));
    expect(container.querySelector('.poster-progress-title')?.textContent).toBe('正在拉取素材 12/86');
    expect(container.querySelector('.poster-active-assets')?.textContent).toContain('菲比 · 海报立绘');
    expect(container.querySelector('.poster-active-assets')?.textContent).toContain('1.0 MB / 2.0 MB');
    expect(container.querySelector('.poster-active-assets')?.textContent).toContain('第2次尝试');
    expect(container.querySelector('progress')?.getAttribute('value')).toBe('12');
    const signal = vi.mocked(createRankingPoster).mock.calls[0][3]!;
    await clickText('取消生成');
    expect(signal.aborted).toBe(true);
    expect(container.querySelector('[role=dialog]')).toBeNull();
    await act(async () => pending.reject(new DOMException('cancel', 'AbortError')));
    expect(container.textContent).not.toContain('cancel');
  });

  it('来源本身未提供背景的角色在预览中明确列出，不冒充加载成功', async () => {
    vi.mocked(createRankingPoster).mockResolvedValue({ ...posterResult(), unavailableBackgrounds: ['秧秧'] });
    await render(); await clickText('分享海报');
    expect(container.querySelector('.poster-source-note')?.textContent).toContain('1位角色的来源未提供海报立绘');
    expect(container.querySelector('.poster-source-note')?.textContent).toContain('秧秧');
  });

  it('卸载后才返回的生成任务不创建预览URL或触发下载', async () => {
    const pending = deferred<RankingPoster>();
    vi.mocked(createRankingPoster).mockReturnValue(pending.promise);
    await render(); await clickText('分享海报');
    const signal = vi.mocked(createRankingPoster).mock.calls[0][3]!;
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    root = createRoot(container);
    await act(async () => pending.resolve(posterResult(new Blob(['obsolete']))));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('名称版文件经过确认再导入，只将解析后的完整榜单交给持久层', async () => {
    const currentCatalog = vi.mocked(useCatalog)();
    vi.mocked(useCatalog).mockReturnValue({
      ...currentCatalog,
      characters: [
        { ...fixture('one'), name: '今汐', displayName: '今汐' },
        { ...fixture('two'), name: '长离', displayName: '长离' },
      ],
    });
    const currentPreferences = vi.mocked(usePreferences)();
    const importPreferences = vi.fn(async () => undefined);
    vi.mocked(usePreferences).mockReturnValue({ ...currentPreferences, importPreferences });
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    const json = JSON.stringify({ version: 2, title: '测试XP排行榜', characters: [
      { name: '长离', form: '长离' }, { name: '今汐', form: '今汐' },
    ] });
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: '榜单.json', size: 300, text: async () => json }] });
    await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); });
    expect(importPreferences).not.toHaveBeenCalled();
    expect(container.querySelector('[role=dialog]')?.textContent).toContain('榜单.json');
    await clickText('确认导入');
    expect(importPreferences).toHaveBeenCalledWith(expect.objectContaining({
      title: '测试XP排行榜', order: ['two', 'one'], selectedVariants: { two: 'two', one: 'one' },
    }));
    expect(container.querySelector('[role=dialog]')).toBeNull();
  });
});
