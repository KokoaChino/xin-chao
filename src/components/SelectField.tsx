import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

interface Option { value: string; label: string; disabled: boolean }
export default function SelectField({ label, value, onChange, children, disabled = false, ariaLabel }: {
  label?: string; value: string; onChange: (value: string) => void; children: ReactNode; disabled?: boolean; ariaLabel?: string;
}) {
  const options: Option[] = Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child)) return [];
    const text = String(child.props.children ?? '');
    return [{ value: child.props.value ?? text, label: text, disabled: Boolean(child.props.disabled) }];
  });
  const selected = options.findIndex(option => option.value === value);
  const [open, setOpen] = useState(false); const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 150, maxHeight: 280 });
  const trigger = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null);
  const listId = useId(); const search = useRef({ text: '', time: 0 });
  const choose = (index: number) => { const option = options[index]; if (!option || option.disabled) return; onChange(option.value); setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const show = () => { if (!disabled) { setActive(Math.max(0, selected)); setOpen(true); } };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const place = () => {
      const bounds = trigger.current!.getBoundingClientRect();
      const width = Math.min(Math.max(bounds.width, 160), window.innerWidth - 24);
      const desired = Math.min(320, options.length * 43 + 12);
      const below = window.innerHeight - bounds.bottom - 16, above = bounds.top - 16;
      const flip = below < Math.min(desired, 180) && above > below;
      const maxHeight = Math.min(desired, flip ? above : below);
      setPosition({ left: Math.min(Math.max(12, bounds.left), window.innerWidth - width - 12), top: flip ? bounds.top - maxHeight - 7 : bounds.bottom + 7, width, maxHeight: Math.max(100, maxHeight) });
    };
    place();
    const resize = () => place();
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) place(); };
    window.addEventListener('resize', resize); document.addEventListener('scroll', scroll, true);
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => { window.removeEventListener('resize', resize); document.removeEventListener('scroll', scroll, true); document.removeEventListener('pointerdown', outside, true); };
  }, [open, options.length]);
  useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [open, active, listId]);
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!open) { show(); return; }
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      let next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (active + direction + options.length) % options.length;
      for (let count = 0; count < options.length && options[next]?.disabled; count++) next = (next + direction + options.length) % options.length;
      setActive(next); return;
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (open) choose(active); else show(); return; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const now = Date.now(); search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + event.key.toLocaleLowerCase(), time: now };
      const match = options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(search.current.text));
      if (match >= 0) { if (!open) show(); setActive(match); }
    }
  };
  return <div className="select-field">{label && <span className="select-label">{label}</span>}<div className="select-control"><button ref={trigger} type="button" className="select-trigger" role="combobox" aria-label={ariaLabel || label} aria-expanded={open} aria-controls={open ? listId : undefined} aria-haspopup="listbox" aria-activedescendant={open ? `${listId}-${active}` : undefined} disabled={disabled} onClick={() => open ? setOpen(false) : show()} onKeyDown={keyDown}><span>{options[selected]?.label || '请选择'}</span><ChevronDown size={14} /></button></div>
    {open && createPortal(<div ref={menu} id={listId} role="listbox" aria-label={ariaLabel || label} className="select-menu" style={position}>{options.map((option, index) => <button type="button" role="option" id={`${listId}-${index}`} key={option.value} aria-selected={value === option.value} disabled={option.disabled} tabIndex={-1} className={`${index === active ? 'is-active' : ''} ${value === option.value ? 'is-selected' : ''}`} onPointerMove={() => setActive(index)} onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}><span>{option.label}</span>{value === option.value && <Check size={14} />}</button>)}</div>, document.body)}
  </div>;
}
