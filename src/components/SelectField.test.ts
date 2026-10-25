import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';
import SelectField from './SelectField';

it('菜单挂在body并贴合触发框定位；键盘可跳过禁用选项，选择后关闭', async () => {
  const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', window.document);
  vi.stubGlobal('HTMLElement', window.HTMLElement); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperties(window, { innerWidth: { configurable: true, value: 1000 }, innerHeight: { configurable: true, value: 800 } });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 200, bottom: 242, left: 500, width: 180 }) as DOMRect;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  const root = createRoot(window.document.getElementById('root')!);
  const onChange = vi.fn();
  const key = async (value: string) => {
    const event = new window.Event('keydown', { bubbles: true });
    Object.defineProperty(event, 'key', { value });
    await act(async () => window.document.querySelector('button')!.dispatchEvent(event));
  };
  try {
    await act(async () => root.render(createElement(SelectField, {
      label: '属性', value: '', onChange,
      children: [
        createElement('option', { value: '', key: '' }, '全部属性'),
        createElement('option', { value: '冷凝', key: '冷凝', disabled: true }, '冷凝'),
        createElement('option', { value: '热熔', key: '热熔' }, '热熔'),
      ],
    })));
    await act(async () => window.document.querySelector('button')!.click());
    const menu = window.document.querySelector<HTMLElement>('[role=listbox]')!;
    expect(menu.parentElement).toBe(window.document.body);
    expect(menu.style.left).toBe('500px');
    expect(menu.style.top).toBe('249px');
    expect(menu.style.width).toBe('180px');
    await key('ArrowDown'); await key('Enter');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('热熔');
    expect(window.document.querySelector('[role=listbox]')).toBeNull();
    await key('ArrowDown'); await key('Escape');
    expect(window.document.querySelector('[role=listbox]')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount()); vi.unstubAllGlobals();
  }
});
