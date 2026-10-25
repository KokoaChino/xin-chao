import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CharacterDetail, { type CharacterDetailProps } from './CharacterDetail';
import type { Character } from '../types';

vi.mock('./SafeHtml', () => ({
  default: ({ html }: { html: string }) => createElement('div', {}, html),
}));

function fixture(overrides: Partial<Character> = {}): Character {
  return {
    id: 'one', identityId: 'one', name: '角色一', displayName: '角色一', romanizedName: 'ONE',
    description: '最初的简介', resonanceName: '共鸣能力', gender: '女', origin: '今州',
    affiliation: '今州', weapon: '迅刀', element: '衍射', releaseVersion: 'V1.0',
    avatar: { url: 'https://example.test/avatar.png' }, hero: null, poster: null,
    hasOutfits: false, voiceCount: 0, isPreview: false,
    sourceUrl: 'https://wiki.kurobbs.com/mc/item/one', fetchedAt: '2026-10-23T12:00:00Z',
    identity: '', specialty: '', cv: {}, artworks: [], treasures: [], stories: [],
    archives: [{ id: 'archive', title: '角色档案', html: '<p>旧档案正文</p>' }],
    outfits: [], voices: [], syncWarnings: [], ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('打开中的角色详情同步', () => {
  let root: Root;
  let container: HTMLElement;
  let props: CharacterDetailProps;
  let pause: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('HTMLElement', window.HTMLElement);
    vi.stubGlobal('HTMLImageElement', window.HTMLImageElement);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
    pause = vi.fn();
    Object.assign(window.HTMLElement.prototype, {
      play: vi.fn(() => Promise.resolve()),
      pause,
      load: vi.fn(),
    });
    container = window.document.getElementById('root')!;
    root = createRoot(container);
    const character = fixture();
    props = {
      summary: character, variants: [character], loadCharacter: async () => character,
      onClose: vi.fn(),
      onSelectVariant: vi.fn(),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => root.render(createElement(CharacterDetail, props)));
  }

  async function click(selector: string) {
    const element = container.querySelector<HTMLButtonElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    await act(async () => element.click());
  }

  it('详情不再重复展示属性标签或入榜操作，当前语言的语音一次展示全部', async () => {
    const voices = Array.from({ length: 40 }, (_, index) => ({
      id: `voice-${index}`, title: `台词${index}`, text: `完整台词${index}`,
      url: `https://example.test/${index}.wav`, language: '中文', cv: '', category: 'personality' as const,
    }));
    const character = fixture({ voices, voiceCount: voices.length });
    props.summary = character;
    props.loadCharacter = async () => character;
    await render();
    expect(container.querySelector('.detail-header-bottom')).toBeNull();
    expect(container.querySelector('.detail-rank-button')).toBeNull();
    await click('[role="tab"][id$="-voices"]');
    expect(container.querySelectorAll('.detail-voice-row')).toHaveLength(40);
    expect(container.querySelector('.detail-load-more')).toBeNull();
    expect(container.textContent).toContain('完整台词39');
  });

  it('目录日期更新时静默重读，保留当前栏目与旧正文，成功后显示新正文', async () => {
    const next = deferred<Character>();
    const load = vi.fn().mockResolvedValueOnce(fixture()).mockReturnValueOnce(next.promise);
    props.loadCharacter = load;
    await render();
    await click('[role="tab"][id$="-archives"]');
    expect(container.textContent).toContain('旧档案正文');

    props.summary = fixture({ fetchedAt: '2026-10-24T12:00:00Z' });
    await render();
    expect(load).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('档案');
    expect(container.textContent).toContain('旧档案正文');
    expect(container.querySelector('.detail-loading')).toBeNull();

    await act(async () => next.resolve(fixture({
      fetchedAt: props.summary.fetchedAt,
      archives: [{ id: 'archive', title: '角色档案', html: '<p>最新档案正文</p>' }],
    })));
    expect(container.textContent).toContain('最新档案正文');
    expect(container.textContent).not.toContain('旧档案正文');
  });

  it('连续更新只接受最新请求，更新读取失败也不会清空当前资料', async () => {
    const obsolete = deferred<Character>();
    const latest = deferred<Character>();
    const failed = deferred<Character>();
    props.loadCharacter = vi.fn()
      .mockResolvedValueOnce(fixture())
      .mockReturnValueOnce(obsolete.promise)
      .mockReturnValueOnce(latest.promise)
      .mockReturnValueOnce(failed.promise);
    await render();
    props.summary = fixture({ fetchedAt: '2026-10-24T12:00:00Z' });
    await render();
    props.summary = fixture({ fetchedAt: '2026-10-25T12:00:00Z' });
    await render();
    await act(async () => latest.resolve(fixture({ description: '新的有效简介', fetchedAt: props.summary.fetchedAt })));
    await act(async () => obsolete.resolve(fixture({ description: '已经过期的响应' })));
    expect(container.textContent).toContain('新的有效简介');
    expect(container.textContent).not.toContain('已经过期的响应');

    props.summary = fixture({ fetchedAt: '2026-10-26T12:00:00Z' });
    await render();
    await act(async () => failed.reject(new Error('offline')));
    expect(container.textContent).toContain('新的有效简介');
    expect(container.textContent).toContain('仍展示上次收录的资料');
  });

  it('后台增加语音时保留正在播放的音轨，当前音轨被移除时停止', async () => {
    const voice = { id: 'voice', title: '心声', text: '最初台词', url: 'https://example.test/voice.wav', language: '中文', cv: '', category: 'personality' as const };
    const existing = fixture({ voices: [voice], voiceCount: 1 });
    const next = deferred<Character>();
    const removed = deferred<Character>();
    props.summary = existing;
    props.loadCharacter = vi.fn().mockResolvedValueOnce(existing).mockReturnValueOnce(next.promise).mockReturnValueOnce(removed.promise);
    await render();
    await click('[role="tab"][id$="-voices"]');
    await click('[aria-label="播放：心声"]');
    const pauseCount = pause.mock.calls.length;
    const audio = container.querySelector('audio');
    const additional = { ...voice, id: 'second', title: '新的心声', url: 'https://example.test/second.wav' };

    props.summary = { ...existing, fetchedAt: '2026-10-24T12:00:00Z' };
    await render();
    await act(async () => next.resolve({ ...existing, fetchedAt: props.summary.fetchedAt, voices: [{ ...voice }, additional] }));
    expect(container.querySelector('audio')).toBe(audio);
    expect(container.querySelector('[aria-label="暂停：心声"]')).not.toBeNull();
    expect(pause.mock.calls.length).toBe(pauseCount);
    expect(container.textContent).toContain('新的心声');

    props.summary = { ...existing, fetchedAt: '2026-10-25T12:00:00Z' };
    await render();
    await act(async () => removed.resolve({ ...existing, fetchedAt: props.summary.fetchedAt, voices: [additional] }));
    expect(pause.mock.calls.length).toBeGreaterThan(pauseCount);
    expect(container.querySelector('.detail-audio-console')).toBeNull();
  });
});
