import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dialog from './Dialog';

describe('弹窗焦点恢复', () => {
  let root: Root;
  let container: HTMLElement;
  let trigger: HTMLButtonElement;
  let external: HTMLButtonElement;

  beforeEach(() => {
    const { window } = parseHTML('<!doctype html><html><body><button id="trigger">打开</button><button id="external">提示</button><div id="root"></div></body></html>');
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('HTMLElement', window.HTMLElement);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let focused: Element = window.document.body;
    Object.defineProperty(window.document, 'activeElement', { configurable: true, get: () => focused });
    vi.spyOn(window.HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused = this;
    });
    container = window.document.getElementById('root')!;
    trigger = window.document.getElementById('trigger') as HTMLButtonElement;
    external = window.document.getElementById('external') as HTMLButtonElement;
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([false, true])('焦点被外部提示夺走后，Shift=%s 的 Tab 回到弹窗并阻止默认跳转', async (shiftKey) => {
    trigger.focus();
    await act(async () => root.render(createElement(Dialog, {
      title: '榜单设置',
      onClose: vi.fn(),
      children: createElement('button', { id: 'save' }, '保存'),
    })));
    external.focus();
    expect(document.activeElement).toBe(external);

    const event = new window.Event('keydown', { bubbles: true, cancelable: true });
    Object.defineProperties(event, { key: { value: 'Tab' }, shiftKey: { value: shiftKey } });
    await act(async () => document.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(container.querySelector(shiftKey ? '#save' : '.dialog-close'));

    await act(async () => root.render(null));
    expect(document.activeElement).toBe(trigger);
  });
});
