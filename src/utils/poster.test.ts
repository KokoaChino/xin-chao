import { afterEach, expect, it, vi } from 'vitest';
import { createRankingPoster, PosterAssetsError } from './poster';
import { preparePosterAssets } from './poster-assets';
import { createDefaultPreferences } from '../data/preferences';
import type { CharacterSummary } from '../types';

vi.mock('./poster-assets', async original => ({
  ...await original<typeof import('./poster-assets')>(),
  preparePosterAssets: vi.fn(),
}));

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('素材缺失时在任何画布绘制之前失败，不返回单字头像或缺背景的图片', async () => {
  const createCanvas = vi.fn(), load = vi.fn(async () => [{}]), querySelector = vi.fn(() => null);
  vi.stubGlobal('document', { querySelector, fonts: { load }, createElement: createCanvas });
  const failure = new PosterAssetsError([{ label: '西格莉卡 · 头像', url: 'https://images.example/avatar.png', attempts: 3, reason: '请求超时' }]);
  vi.mocked(preparePosterAssets).mockRejectedValue(failure);
  const character = { id: '1', name: '西格莉卡', displayName: '西格莉卡', avatar: { url: 'https://images.example/avatar.png' }, poster: null } as CharacterSummary;
  await expect(createRankingPoster([{ id: '1', character, variants: [character] }], createDefaultPreferences())).rejects.toBe(failure);
  expect(load).toHaveBeenCalledTimes(3);
  expect(querySelector).toHaveBeenCalledWith('link[rel="stylesheet"][href*="fonts.googleapis.com"]');
  expect(createCanvas).not.toHaveBeenCalled();
});

it('指定字体不可用时明确失败，不用系统替代字体继续导出', async () => {
  const createCanvas = vi.fn();
  vi.stubGlobal('document', { querySelector: () => null, fonts: { load: async () => [] }, createElement: createCanvas });
  const character = { id: '1', name: '今汐', displayName: '今汐', avatar: { url: 'https://images.example/avatar.png' }, poster: null } as CharacterSummary;
  await expect(createRankingPoster([{ id: '1', character, variants: [character] }], createDefaultPreferences())).rejects.toThrow('字体未能完整加载');
  expect(preparePosterAssets).not.toHaveBeenCalled();
  expect(createCanvas).not.toHaveBeenCalled();
});
