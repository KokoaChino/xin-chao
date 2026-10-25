import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';
import OfficialVideos from './OfficialVideos';
import type { CharacterSummary } from '../types';

it('按角色显示官方影片，主动点击才创建播放器，关闭栏目会卸载iframe', async () => {
  const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('HTMLElement', window.HTMLElement);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      schemaVersion: 1, ownerMid: '1955897084',
      videos: [
        { bvid: 'BV1Nb421n7Kh', title: '今汐宣传片', category: '角色宣传', characterNames: ['今汐'], url: 'https://www.bilibili.com/video/BV1Nb421n7Kh/', cover: '', duration: '' },
        { bvid: 'BV1R8nF65Eme', title: '锁暝宣传片', category: '角色宣传', characterNames: ['锁暝'], url: 'https://www.bilibili.com/video/BV1R8nF65Eme/', cover: '', duration: '' },
        { bvid: 'invalid&evil', title: '无效影片', category: '角色宣传', characterNames: ['今汐'] },
      ],
    }),
  })));
  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(OfficialVideos, { character: { id: 'jinxi', identityId: 'jinxi', name: '今汐' } as CharacterSummary })));
    expect(container.textContent).toContain('今汐宣传片');
    expect(container.textContent).not.toContain('锁暝宣传片');
    expect(container.textContent).not.toContain('无效影片');
    expect(container.querySelector('iframe')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('.official-video-card')!.click());
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toContain('bvid=BV1Nb421n7Kh');
    expect(iframe?.getAttribute('src')).toContain('autoplay=0');
    expect(container.querySelector('.official-player-caption a')?.getAttribute('href')).toBe('https://www.bilibili.com/video/BV1Nb421n7Kh/');
    await act(async () => root.render(null));
    expect(container.querySelector('iframe')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
