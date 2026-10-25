import type { Preferences } from '../types';
import type { RosterEntry } from './display';
import { characterName, imageUrl } from './display';
import { rankingTitle } from './backup';
import { encodePng, type PixelStrip } from './png';
import { MAX_POSTER_CHARACTERS, POSTER_WIDTHS, PosterResourceError, withPosterQuality, type PosterWidth } from './poster-quality';

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

export function posterLayout(total: number, width: PosterWidth = POSTER_WIDTHS[0]) {
  if (!Number.isInteger(total) || total < 1) throw new Error('请先将共鸣者加入榜单。');
  if (total > MAX_POSTER_CHARACTERS) throw new Error(`海报最多支持${MAX_POSTER_CHARACTERS}位共鸣者，请减少榜单人数后重试。`);
  return { width, logicalWidth: 1080, scale: width / 1080, columns: 1, margin: 48, gap: 18, cardWidth: 984, avatarSize: 230, numberOffset: 20, numberWidth: 78, avatarOffset: 120, textOffset: 390, textWidth: 556 };
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new PosterResourceError('海报预览分配失败。')), 'image/png'); }
    catch (error) { reject(error); }
  });
}

type PosterProgress = (done: number, total: number, width?: PosterWidth) => void;

export async function createRankingPoster(
  entries: RosterEntry[], preferences: Preferences, onProgress?: PosterProgress, signal?: AbortSignal,
): Promise<RankingPoster> {
  posterLayout(entries.length);
  signal?.throwIfAborted();
  if (typeof CompressionStream === 'undefined') throw new Error('当前浏览器不支持长图导出，请更新浏览器后重试。');
  await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))]);
  return withPosterQuality(
    width => renderRankingPoster(entries, preferences, width, onProgress, signal),
    signal, width => onProgress?.(0, entries.length, width),
  );
}

async function renderRankingPoster(
  entries: RosterEntry[], preferences: Preferences, outputWidth: PosterWidth, onProgress?: PosterProgress, signal?: AbortSignal,
): Promise<RankingPoster> {
  const layout = posterLayout(entries.length, outputWidth);
  const { width, logicalWidth, scale, margin, gap, cardWidth, avatarSize, numberOffset, numberWidth, avatarOffset, textOffset, textWidth } = layout;
  const canvas = document.createElement('canvas');
  const previewCanvas = document.createElement('canvas');
  type RowImages = { avatar: HTMLImageElement | null; background: HTMLImageElement | null };
  const images = new Map<number, RowImages>();
  try {
    canvas.width = width; canvas.height = 1024;
    if (canvas.width !== width || canvas.height !== 1024) throw new PosterResourceError('画布尺寸分配失败。');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new PosterResourceError('画布分配失败。');
    previewCanvas.width = Math.round(width / 2);
    const previewContext = previewCanvas.getContext('2d');
    if (!previewContext) throw new PosterResourceError('预览画布分配失败。');
    const ctx: CanvasRenderingContext2D = context;
    ctx.font = '24px "Noto Serif SC", serif';
    let cursor = 174;
    const rows = entries.map(entry => {
      const lines = RANKING_FIELDS.flatMap(field => wrapText(ctx, `${field.label}：${entry.character[field.key] || '—'}`, textWidth));
      const height = Math.max(avatarSize + 64, 114 + lines.length * 37);
      const row = { entry, lines, height, y: cursor };
      cursor += height + gap; return row;
    });
    const height = Math.ceil((cursor + 90) * scale), logicalHeight = height / scale;
    const previews: RankingPoster['previews'] = [];
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
          for (let index = firstRow; index < rows.length && rows[index].y * scale < bottom; index++) {
            if ((rows[index].y + rows[index].height) * scale > top) visible.push(index);
          }
          await Promise.all(visible.filter(index => !images.has(index)).map(async index => {
            const c = rows[index].entry.character;
            const [avatar, background] = await Promise.all([
              loadImage(c.avatar.url, Math.min(c.avatar.width || Infinity, Math.max(360, Math.ceil(avatarSize * scale * 1.25))), signal)
                .then(image => image || (c.avatar.fallbackUrl ? loadImage(c.avatar.fallbackUrl, Math.max(360, Math.ceil(avatarSize * scale * 1.25)), signal) : null)),
              loadImage(c.poster?.url || '', Math.min(c.poster?.width || Infinity, width), signal),
            ]);
            images.set(index, { avatar, background });
          }));
          signal?.throwIfAborted();
          ctx.setTransform(scale, 0, 0, scale, 0, -top);
          const wash = ctx.createLinearGradient(0, 0, logicalWidth, logicalHeight);
          wash.addColorStop(0, '#dfe8e1'); wash.addColorStop(1, '#f5f1e8');
          ctx.fillStyle = wash; ctx.fillRect(0, top / scale, logicalWidth, stripHeight / scale);
          if (top === 0) {
            ctx.fillStyle = '#263d34'; ctx.font = '600 42px "Noto Serif SC", serif';
            ctx.fillText(rankingTitle(preferences.title), margin, 84, logicalWidth - margin * 2);
            ctx.fillStyle = '#83917e'; ctx.font = '20px sans-serif'; ctx.fillText(`${entries.length} 位共鸣者`, margin, 131);
          }
          visible.forEach(drawRow);
          if (bottom === height) {
            ctx.fillStyle = '#96a08d'; ctx.font = '15px sans-serif'; ctx.textAlign = 'right';
            ctx.fillText('角色素材归库洛游戏及相关权利方所有', logicalWidth - margin, logicalHeight - 28);
          }
          // Keep previews lightweight while preserving full-resolution pixels for the download.
          previewCanvas.height = Math.ceil(stripHeight / 2);
          previewContext!.drawImage(canvas, 0, 0, previewCanvas.width, previewCanvas.height);
          previews.push({ blob: await canvasBlob(previewCanvas), width: previewCanvas.width, height: previewCanvas.height });
          signal?.throwIfAborted();
          const pixels = ctx.getImageData(0, 0, width, stripHeight);
          if (pixels.data[3] === 0 || ctx.isContextLost?.()) throw new PosterResourceError('画布像素分配失败。');
          while (firstRow < rows.length && (rows[firstRow].y + rows[firstRow].height) * scale <= bottom) {
            images.delete(firstRow++); completed++;
          }
          onProgress?.(completed, entries.length, width);
          yield { height: stripHeight, data: pixels.data };
        }
      } finally {
        images.clear(); canvas.width = 1; canvas.height = 1;
      }
    }
    const blob = await encodePng(width, height, renderStrips(), signal);
    return { blob, previews, width, height };
  } finally {
    images.clear(); canvas.width = 1; canvas.height = 1;
    previewCanvas.width = 1; previewCanvas.height = 1;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
