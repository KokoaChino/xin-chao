import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import type { KeyboardEvent, MouseEvent } from 'react';
import { imageUrl } from '../utils/display';

interface SafeHtmlProps {
  html: string;
  className?: string;
  onImageClick?: (url: string, label: string) => void;
  textOnlyTables?: boolean;
}

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'span', 'div',
  'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'img', 'hr', 'sup', 'sub', 'ruby', 'rt',
];

function cleanHtml(html: string, interactiveImages: boolean, textOnlyTables: boolean): string {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan'],
    RETURN_DOM_FRAGMENT: true,
  });

  if (textOnlyTables) {
    fragment.querySelectorAll('img').forEach((image) => image.remove());
    for (const table of fragment.querySelectorAll('table')) {
      const textContent = document.createElement('div');
      for (const cell of table.querySelectorAll('td, th')) {
        if (!cell.textContent?.trim()) continue;
        const block = document.createElement('div');
        block.append(...Array.from(cell.childNodes));
        textContent.append(block);
      }
      table.replaceWith(textContent);
    }
  }

  for (const anchor of fragment.querySelectorAll('a')) {
    const href = anchor.getAttribute('href');
    if (!href) continue;
    try {
      const url = new URL(href, 'https://wiki.kurobbs.com');
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        anchor.removeAttribute('href');
        continue;
      }
      anchor.href = url.href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    } catch {
      anchor.removeAttribute('href');
    }
  }

  for (const image of fragment.querySelectorAll('img')) {
    const src = image.getAttribute('src');
    try {
      const url = new URL(src ?? '', 'https://wiki.kurobbs.com');
      if (!src || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
        image.remove();
        continue;
      }
      image.setAttribute('data-original-src', url.href);
      image.src = imageUrl(url.href, 800);
      image.loading = 'lazy';
      image.decoding = 'async';
      if (interactiveImages) {
        image.tabIndex = 0;
        image.setAttribute('role', 'button');
        image.setAttribute('aria-label', `放大查看${image.alt || '资料图片'}`);
      }
    } catch {
      image.remove();
    }
  }

  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

export default function SafeHtml({ html, className = '', onImageClick, textOnlyTables = false }: SafeHtmlProps) {
  const safeHtml = useMemo(() => cleanHtml(html, Boolean(onImageClick), textOnlyTables), [html, onImageClick, textOnlyTables]);

  function openImage(target: EventTarget | null) {
    if (target instanceof HTMLImageElement && target.src) {
      onImageClick?.(target.getAttribute('data-original-src') || target.src, target.alt || '资料图片');
    }
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if (onImageClick && event.target instanceof HTMLImageElement) event.preventDefault();
    openImage(event.target);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      onImageClick &&
      event.target instanceof HTMLImageElement &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault();
      openImage(event.target);
    }
  }

  return (
    <div
      className={`detail-prose ${className}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
