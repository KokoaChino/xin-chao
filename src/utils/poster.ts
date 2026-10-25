import type { Preferences } from '../types';
import type { RosterEntry } from './display';
import { characterName, imageUrl } from './display';
import { rankingTitle } from './backup';
import { encodePng, type PixelStrip } from './png';

export interface RankingPoster {
  blob: Blob;
  previews: { blob: Blob; width: number; height: number }[];
  width: number;
  height: number;
}

export const RANKING_FIELDS = [
  { key: 'resonanceName', label: '共鸣能力' },
  { key: 'affiliation', label: '所属' }, { key: 'element', label: '属性' },
  { key: 'weapon', label: '武器类型' }, { key: 'releaseVersion', label: '实装版本' },
] as const;

function loadImage(url: string, size: number, signal?: AbortSignal): Promise<HTMLImageElement | null> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    if (!url) { resolve(null); return; }
    const image = new Image(); image.crossOrigin = 'anonymous'; image.decoding = 'async';
    const finish = (value: HTMLImageElement | null, error?: unknown) => {
      clearTimeout(timer); image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort);
      if (!value) image.src = '';
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(null, signal?.reason ?? new DOMException('已取消', 'AbortError'));
    const timer = setTimeout(() => finish(null), 12000);
    image.onload = () => finish(image); image.onerror = () => finish(null);
    signal?.addEventListener('abort', abort, { once: true });
    image.src = imageUrl(url, size);
  });
}

function wrapText(ctx: CanvasRenderingContext2D, value: string, width: number): string[] {
  const lines: string[] = []; let line = '';
  for (const char of value.replace(/\s+/g, ' ')) {
    if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ''; }
    line += char;
  }
  lines.push(line); return lines;
}

export function posterLayout(total: number) {
  if (!Number.isInteger(total) || total < 1 || total > 2000) throw new Error('请先将共鸣者加入榜单。');
  return { width: 1080, columns: 1, margin: 48, gap: 18, cardWidth: 984, avatarSize: 230, numberOffset: 20, numberWidth: 78, avatarOffset: 120, textOffset: 390, textWidth: 556 };
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('海报预览生成失败，请重试。')), 'image/png'); }
    catch { reject(new Error('部分图片暂时无法导出，请稍后重试。')); }
  });
}

export async function createRankingPoster(
  entries: RosterEntry[], preferences: Preferences, onProgress?: (done: number, total: number) => void, signal?: AbortSignal,
): Promise<RankingPoster> {
  const layout = posterLayout(entries.length);
  const { width, margin, gap, cardWidth, avatarSize, numberOffset, numberWidth, avatarOffset, textOffset, textWidth } = layout;
  signal?.throwIfAborted();
  await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))]);
  signal?.throwIfAborted();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器无法生成海报。');
  const ctx: CanvasRenderingContext2D = context;
  ctx.font = '24px "Noto Serif SC", serif';
  let cursor = 174;
  const rows = entries.map(entry => {
    const lines = RANKING_FIELDS.flatMap(field => wrapText(ctx, `${field.label}：${entry.character[field.key] || '—'}`, textWidth));
    const height = Math.max(avatarSize + 64, 114 + lines.length * 37);
    const row = { entry, lines, height, y: cursor };
    cursor += height + gap; return row;
  });
  const height = cursor + 90;
  const previewCanvas = document.createElement('canvas'), previews: RankingPoster['previews'] = [];
  previewCanvas.width = width / 2;
  const previewContext = previewCanvas.getContext('2d');
  if (!previewContext) throw new Error('当前浏览器无法生成海报预览。');
  type RowImages = { avatar: HTMLImageElement | null; background: HTMLImageElement | null };
  const images = new Map<number, RowImages>();
  let firstRow = 0, completed = 0;

  function drawRow(index: number) {
    const row = rows[index], c = row.entry.character, y = row.y;
    ctx.save(); ctx.beginPath(); ctx.roundRect(margin, y, cardWidth, row.height, 18); ctx.clip();
    ctx.fillStyle = '#f9fbf4'; ctx.fillRect(margin, y, cardWidth, row.height);
    const background = images.get(index)?.background;
    if (background) {
      const scale = Math.max(cardWidth / background.naturalWidth, row.height / background.naturalHeight);
      ctx.globalAlpha = .48;
      ctx.drawImage(background, margin + cardWidth - background.naturalWidth * scale, y + (row.height - background.naturalHeight * scale) * .35, background.naturalWidth * scale, background.naturalHeight * scale);
      ctx.globalAlpha = 1;
    }
    const veil = ctx.createLinearGradient(margin, 0, margin + cardWidth, 0);
    veil.addColorStop(0, '#f5f8ef78'); veil.addColorStop(.4, '#fbfcf4c2'); veil.addColorStop(1, '#fbfcf442');
    ctx.fillStyle = veil; ctx.fillRect(margin, y, cardWidth, row.height);
    ctx.save(); ctx.translate(margin + cardWidth - 22, y + row.height - 20); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#4b705013'; ctx.font = '600 58px sans-serif';
    ctx.fillText(c.romanizedName.toUpperCase(), 0, 0, row.height - 40); ctx.restore();
    ctx.fillStyle = index === 0 ? '#9f7c48' : '#819476'; ctx.font = '500 50px "Noto Serif SC", serif';
    ctx.fillText(String(index + 1).padStart(2, '0'), margin + numberOffset, y + 62, numberWidth);
    const ix = margin + avatarOffset, iy = y + (row.height - avatarSize) / 2;
    ctx.save(); ctx.beginPath(); ctx.roundRect(ix, iy, avatarSize, avatarSize, 12); ctx.clip();
    ctx.fillStyle = '#e5eddf'; ctx.fillRect(ix, iy, avatarSize, avatarSize);
    const avatar = images.get(index)?.avatar;
    if (avatar) {
      const scale = Math.min(avatarSize / avatar.naturalWidth, avatarSize / avatar.naturalHeight);
      const iw = avatar.naturalWidth * scale, ih = avatar.naturalHeight * scale;
      ctx.drawImage(avatar, ix + (avatarSize - iw) / 2, iy + (avatarSize - ih) / 2, iw, ih);
    } else {
      ctx.fillStyle = '#8a9f7b'; ctx.font = '48px serif'; ctx.fillText(characterName(c).slice(0, 1), ix + 88, iy + 140);
    }
    ctx.restore();
    const textX = margin + textOffset;
    ctx.fillStyle = '#263d34'; ctx.font = '600 34px "Noto Serif SC", serif'; ctx.fillText(characterName(c), textX, y + 58, textWidth);
    ctx.fillStyle = '#596e50'; ctx.font = '24px "Noto Serif SC", serif';
    row.lines.forEach((line, lineIndex) => ctx.fillText(line, textX, y + 102 + lineIndex * 37));
    ctx.restore();
  }

  async function* renderStrips(): AsyncGenerator<PixelStrip> {
    try {
      // Only a small rendering window and its source images are resident at once.
      for (let top = 0; top < height; top += 1024) {
        signal?.throwIfAborted();
        const stripHeight = Math.min(1024, height - top), bottom = top + stripHeight;
        canvas.height = stripHeight;
        const visible: number[] = [];
        for (let index = firstRow; index < rows.length && rows[index].y < bottom; index++) {
          if (rows[index].y + rows[index].height > top) visible.push(index);
        }
        await Promise.all(visible.filter(index => !images.has(index)).map(async index => {
          const c = rows[index].entry.character;
          const [avatar, background] = await Promise.all([
            loadImage(c.avatar.url, 360, signal).then(image => image || (c.avatar.fallbackUrl ? loadImage(c.avatar.fallbackUrl, 360, signal) : null)),
            loadImage(c.poster?.url || '', 1080, signal),
          ]);
          images.set(index, { avatar, background });
        }));
        signal?.throwIfAborted();
        ctx.setTransform(1, 0, 0, 1, 0, -top);
        const wash = ctx.createLinearGradient(0, 0, width, height);
        wash.addColorStop(0, '#dfe8e1'); wash.addColorStop(1, '#f5f1e8');
        ctx.fillStyle = wash; ctx.fillRect(0, top, width, stripHeight);
        if (top === 0) {
          ctx.fillStyle = '#263d34'; ctx.font = '600 42px "Noto Serif SC", serif';
          ctx.fillText(rankingTitle(preferences.title), margin, 84, width - margin * 2);
          ctx.fillStyle = '#83917e'; ctx.font = '20px sans-serif'; ctx.fillText(`${entries.length} 位共鸣者`, margin, 131);
        }
        visible.forEach(drawRow);
        if (bottom === height) {
          ctx.fillStyle = '#96a08d'; ctx.font = '15px sans-serif'; ctx.textAlign = 'right';
          ctx.fillText('角色素材归库洛游戏及相关权利方所有', width - margin, height - 28);
        }
        // Preview tiles appear as one continuous image without decoding the full-size PNG.
        previewCanvas.height = Math.ceil(stripHeight / 2);
        previewContext!.drawImage(canvas, 0, 0, width / 2, previewCanvas.height);
        previews.push({ blob: await canvasBlob(previewCanvas), width: previewCanvas.width, height: previewCanvas.height });
        signal?.throwIfAborted();
        const pixels = ctx.getImageData(0, 0, width, stripHeight);
        while (firstRow < rows.length && rows[firstRow].y + rows[firstRow].height <= bottom) {
          images.delete(firstRow++); completed++;
        }
        onProgress?.(completed, entries.length);
        yield { height: stripHeight, data: pixels.data };
      }
    } finally {
      images.clear(); canvas.width = 1; canvas.height = 1; previewCanvas.width = 1; previewCanvas.height = 1;
    }
  }
  const blob = await encodePng(width, height, renderStrips(), signal);
  return { blob, previews, width, height };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
