import type { Preferences } from '../types';
import type { RosterEntry } from './display';
import { characterName, imageUrl } from './display';
import { rankingTitle } from './backup';

export const RANKING_FIELDS = [
  { key: 'resonanceName', label: '共鸣能力' },
  { key: 'affiliation', label: '所属' }, { key: 'element', label: '属性' },
  { key: 'weapon', label: '武器类型' }, { key: 'releaseVersion', label: '实装版本' },
] as const;
function loadImage(url: string, size = 360): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    if (!url) { resolve(null); return; }
    const image = new Image(); image.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), 12000);
    image.onload = () => { clearTimeout(timer); resolve(image); }; image.onerror = () => { clearTimeout(timer); resolve(null); };
    image.src = imageUrl(url, size);
  });
}
function wrapText(ctx: CanvasRenderingContext2D, value: string, width: number): string[] {
  const lines: string[] = []; let line = '';
  for (const char of value.replace(/\s+/g, ' ')) { if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ''; } line += char; }
  lines.push(line); return lines;
}
export function posterLayout(total: number) {
  if (!Number.isInteger(total) || total < 1 || total > 2000) throw new Error('请先将共鸣者加入榜单。');
  return { width: 1080, columns: 1, margin: 48, gap: 18, cardWidth: 984, avatarSize: 230, numberOffset: 20, numberWidth: 78, avatarOffset: 120, textOffset: 390, textWidth: 556 };
}
export async function createRankingPoster(entries: RosterEntry[], preferences: Preferences, onProgress?: (done: number, total: number) => void): Promise<Blob[]> {
  const { width, margin, gap, cardWidth, avatarSize, numberOffset, numberWidth, avatarOffset, textOffset, textWidth } = posterLayout(entries.length);
  await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))]);
  const measuringCanvas = document.createElement('canvas'); const measuring = measuringCanvas.getContext('2d');
  if (!measuring) throw new Error('当前浏览器无法生成海报。');
  measuring.font = '24px "Noto Serif SC", serif';
  const rows = entries.map(entry => {
    const lines = RANKING_FIELDS.flatMap(field => wrapText(measuring, `${field.label}：${entry.character[field.key] || '—'}`, textWidth));
    return { entry, lines, height: Math.max(avatarSize + 64, 114 + lines.length * 37) };
  });
  // Long rankings are split into manageable images rather than hitting browser canvas limits.
  const pages: typeof rows[] = []; let current: typeof rows = []; let height = 200;
  for (const row of rows) { if (height + row.height + gap > 9000 && current.length) { pages.push(current); current = []; height = 200; } current.push(row); height += row.height + gap; }
  if (current.length) pages.push(current);
  const images: (HTMLImageElement | null)[] = Array(entries.length).fill(null);
  const backgrounds: (HTMLImageElement | null)[] = Array(entries.length).fill(null); let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (next < entries.length) {
      const index = next++, c = entries[index].character;
      [images[index], backgrounds[index]] = await Promise.all([
        loadImage(c.avatar.url).then(image => image || (c.avatar.fallbackUrl ? loadImage(c.avatar.fallbackUrl) : null)),
        c.poster?.url ? loadImage(c.poster.url, 1080) : Promise.resolve(null),
      ]);
      onProgress?.(++done, entries.length);
    }
  }));
  let absoluteIndex = 0; const blobs: Blob[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 196 + page.reduce((h, row) => h + row.height + gap, 0) + 68;
    const ctx = canvas.getContext('2d')!;
    const wash = ctx.createLinearGradient(0, 0, width, canvas.height); wash.addColorStop(0, '#dfe8e1'); wash.addColorStop(1, '#f5f1e8'); ctx.fillStyle = wash; ctx.fillRect(0, 0, width, canvas.height);
    ctx.fillStyle = '#263d34'; ctx.font = '600 42px "Noto Serif SC", serif'; ctx.fillText(rankingTitle(preferences.title), margin, 84, width - margin * 2);
    ctx.fillStyle = '#83917e'; ctx.font = '20px sans-serif'; ctx.fillText(`${entries.length} 位共鸣者${pages.length > 1 ? ` · ${pageIndex + 1} / ${pages.length}` : ''}`, margin, 131);
    let y = 174;
    for (const row of page) {
      const index = absoluteIndex++, c = row.entry.character;
      ctx.save(); ctx.beginPath(); ctx.roundRect(margin, y, cardWidth, row.height, 18); ctx.clip();
      ctx.fillStyle = '#f9fbf4'; ctx.fillRect(margin, y, cardWidth, row.height);
      const background = backgrounds[index];
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
      ctx.textAlign = 'left'; ctx.fillStyle = '#4b705013'; ctx.font = '600 58px sans-serif';
      ctx.fillText(c.romanizedName.toUpperCase(), 0, 0, row.height - 40); ctx.restore();
      ctx.fillStyle = index === 0 ? '#9f7c48' : '#819476'; ctx.font = '500 50px "Noto Serif SC", serif';
      ctx.fillText(String(index + 1).padStart(2, '0'), margin + numberOffset, y + 62, numberWidth);
      const ix = margin + avatarOffset, iy = y + (row.height - avatarSize) / 2;
      ctx.save(); ctx.beginPath(); ctx.roundRect(ix, iy, avatarSize, avatarSize, 12); ctx.clip(); ctx.fillStyle = '#e5eddf'; ctx.fillRect(ix, iy, avatarSize, avatarSize);
      const image = images[index];
      if (image) { const scale = Math.min(avatarSize / image.naturalWidth, avatarSize / image.naturalHeight), iw = image.naturalWidth * scale, ih = image.naturalHeight * scale; ctx.drawImage(image, ix + (avatarSize - iw) / 2, iy + (avatarSize - ih) / 2, iw, ih); }
      else { ctx.fillStyle = '#8a9f7b'; ctx.font = '48px serif'; ctx.fillText(characterName(c).slice(0, 1), ix + 88, iy + 140); } ctx.restore();
      const textX = margin + textOffset; ctx.fillStyle = '#263d34'; ctx.font = '600 34px "Noto Serif SC", serif'; ctx.fillText(characterName(c), textX, y + 58, textWidth);
      ctx.fillStyle = '#596e50'; ctx.font = '24px "Noto Serif SC", serif';
      row.lines.forEach((line, lineIndex) => ctx.fillText(line, textX, y + 102 + lineIndex * 37));
      ctx.restore(); y += row.height + gap;
    }
    ctx.fillStyle = '#96a08d'; ctx.font = '15px sans-serif'; ctx.textAlign = 'right'; ctx.fillText('角色素材归库洛游戏及相关权利方所有', width - margin, canvas.height - 28);
    blobs.push(await new Promise<Blob>((resolve, reject) => { try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('海报生成失败，请重试。')), 'image/png'); } catch { reject(new Error('部分图片暂时无法导出，请稍后重试。')); } }));
  }
  return blobs;
}
export function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
