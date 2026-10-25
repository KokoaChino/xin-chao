import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Dialog({ title, subtitle, onClose, children, className = '' }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab') return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea,select,[tabindex="0"]') || [])].filter(node => node.offsetParent !== null);
      const first = items[0]; const last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (!ref.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close.current(); }}>
      <div className={`dialog ${className}`} ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <button className="dialog-close icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20} /></button>
        
        <h2>{title}</h2>{subtitle && <p className="dialog-subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
