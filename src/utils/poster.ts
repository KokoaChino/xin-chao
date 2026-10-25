import type { Preferences } from '../types';
import type { RosterEntry } from './display';
import { characterName } from './display';
import { rankingTitle } from './backup';
import { encodePng, type PixelStrip } from './png';
import { MAX_POSTER_CHARACTERS, POSTER_WIDTH, PosterResourceError } from './poster-quality';
import { decodePosterAsset, planPosterAssets, preparePosterAssets, PosterAssetsError, type PosterAssetPlan, type PosterProgress, type PreparedAsset } from './poster-assets';
export { PosterAssetsError, type PosterProgress, type PosterAssetFailure } from './poster-assets';

export interface RankingPoster {
  blob: Blob;
  previews: { blob: Blob; width: number; height: number }[];
  width: number;
  height: number;
  unavailableBackgrounds: string[];
}

export const RANKING_FIELDS = [
  { key: 'resonanceName', label: '共鸣能力' },
  { key: 'affiliation', label: '所属' }, { key: 'element', label: '属性' },
  { key: 'weapon', label: '武器类型' }, { key: 'releaseVersion', label: '实装版本' },
] as const;

function wrapText(ctx: CanvasRenderingContext2D, value: string, width: number): string[] {
  const lines: string[] = []; let line = '';
  for (const char of value.replace(/\s+/g, ' ')) {
    if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ''; }
    line += char;
  }
  lines.push(line); return lines;
}

export function posterLayout(total: number) {
  const width = POSTER_WIDTH;
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

function waitFor<T>(promise: Promise<T>, signal: AbortSignal | undefined, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(signal?.reason ?? new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { finish(); reject(new Error(message)); }, 120_000);
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(value => { finish(); resolve(value); }, error => { finish(); reject(error); });
    if (signal?.aborted) abort();
  });
}

async function prepareFonts(entries: RosterEntry[], preferences: Preferences, signal?: AbortSignal) {
  const stylesheet = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]');
  if (stylesheet && !stylesheet.sheet) {
    let cleanup = () => {};
    try {
      await waitFor(new Promise<void>((resolve, reject) => {
        const loaded = () => resolve(), failed = () => reject(new Error('海报字体样式加载失败，请检查网络后重试。'));
        stylesheet.addEventListener('load', loaded, { once: true }); stylesheet.addEventListener('error', failed, { once: true });
        cleanup = () => { stylesheet.removeEventListener('load', loaded); stylesheet.removeEventListener('error', failed); };
      }), signal, '海报字体等待超过120秒，请检查网络后重试。');
    } finally { cleanup(); }
  }
  const text = rankingTitle(preferences.title) + '共鸣者角色素材归库洛游戏及相关权利方所有0123456789' + entries.map(({ character }) =>
    characterName(character) + RANKING_FIELDS.map(field => field.label + character[field.key]).join('')).join('');
  try {
    const loaded = await waitFor(Promise.all(['400 24px', '500 50px', '600 34px'].map(size => document.fonts.load(`${size} "Noto Serif SC"`, text))), signal, '海报字体等待超过120秒，请检查网络后重试。');
    if (loaded.some(faces => !faces.length)) throw new Error('指定字体没有可用字形');
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error(`海报字体未能完整加载：${error instanceof Error ? error.message : '未知错误'}。本次未生成海报。`);
  }
}

export async function createRankingPoster(
  entries: RosterEntry[], preferences: Preferences, onProgress?: (progress: PosterProgress) => void, signal?: AbortSignal,
): Promise<RankingPoster> {
  posterLayout(entries.length);
  signal?.throwIfAborted();
  if (typeof CompressionStream === 'undefined') throw new Error('当前浏览器不支持长图导出，请更新浏览器后重试。');
  const plan = planPosterAssets(entries, POSTER_WIDTH);
  onProgress?.({ phase: 'preparing', completed: 0, total: entries.length, message: '正在加载海报字体', activeAssets: [], unavailableBackgrounds: plan.unavailableBackgrounds });
  await prepareFonts(entries, preferences, signal);
  const prepared = await preparePosterAssets(plan, onProgress, signal);
  try {
    return await renderRankingPoster(entries, preferences, plan, prepared, onProgress, signal);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof PosterResourceError || (error instanceof Error && ['RangeError', 'QuotaExceededError', 'OutOfMemoryError'].includes(error.name))) {
      throw new Error('当前设备无法完整生成1920高清长图，可能是可用内存不足。本次未生成海报，请关闭其他标签页后重试。');
    }
    throw error;
  } finally { prepared.clear(); }
}

async function renderRankingPoster(
  entries: RosterEntry[], preferences: Preferences, plan: PosterAssetPlan, prepared: Map<string, PreparedAsset>, onProgress?: (progress: PosterProgress) => void, signal?: AbortSignal,
): Promise<RankingPoster> {
  const layout = posterLayout(entries.length);
  const { width, logicalWidth, scale, margin, gap, cardWidth, avatarSize, numberOffset, numberWidth, avatarOffset, textOffset, textWidth } = layout;
  const canvas = document.createElement('canvas');
  const previewCanvas = document.createElement('canvas');
  type DecodedImage = Awaited<ReturnType<typeof decodePosterAsset>>;
  type RowImages = { avatar: DecodedImage; background: DecodedImage | null };
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
      const assets = images.get(index);
      if (!assets?.avatar || (plan.rows[index].background && !assets.background)) throw new Error(`${characterName(c)}的海报素材不完整，本次未生成海报。`);
      ctx.save(); ctx.beginPath(); ctx.roundRect(margin, y, cardWidth, row.height, 18); ctx.clip();
      ctx.fillStyle = '#f9fbf4'; ctx.fillRect(margin, y, cardWidth, row.height);
      const background = assets.background?.image;
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
      const avatar = assets.avatar.image;
      const avatarScale = Math.min(avatarSize / avatar.naturalWidth, avatarSize / avatar.naturalHeight);
      const iw = avatar.naturalWidth * avatarScale, ih = avatar.naturalHeight * avatarScale;
      ctx.drawImage(avatar, ix + (avatarSize - iw) / 2, iy + (avatarSize - ih) / 2, iw, ih);
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
          onProgress?.({ phase: 'rendering', completed, total: entries.length, message: `正在绘制${visible.map(index => characterName(rows[index].entry.character)).join('、')}`, activeAssets: [], unavailableBackgrounds: plan.unavailableBackgrounds });
          for (const index of visible.filter(index => !images.has(index))) {
            const rowPlan = plan.rows[index], held: DecodedImage[] = [];
            let decodingUrl = rowPlan.avatar;
            try {
              const decode = async (url: string): Promise<DecodedImage> => {
                decodingUrl = url;
                const asset = prepared.get(url);
                if (!asset) throw new Error('素材校验不完整');
                const decoded = await decodePosterAsset(asset.blob, signal); held.push(decoded); return decoded;
              };
              const avatar = await decode(rowPlan.avatar);
              const background = rowPlan.background ? await decode(rowPlan.background) : null;
              images.set(index, { avatar, background });
            } catch (error) {
              held.forEach(decoded => decoded.release()); signal?.throwIfAborted();
              throw new PosterAssetsError([{ url: decodingUrl, label: `${characterName(rows[index].entry.character)} · ${decodingUrl === rowPlan.avatar ? '头像' : '海报立绘'}`, reason: error instanceof Error ? error.message : '无法解码', attempts: 1 }]);
            }
          }
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
            const used = images.get(firstRow); used?.avatar.release(); used?.background?.release();
            images.delete(firstRow++); completed++;
          }
          onProgress?.({ phase: completed === entries.length ? 'encoding' : 'rendering', completed, total: entries.length, message: completed === entries.length ? '正在合成完整长图' : `已绘制 ${completed}/${entries.length} 位共鸣者`, activeAssets: [], unavailableBackgrounds: plan.unavailableBackgrounds });
          yield { height: stripHeight, data: pixels.data };
        }
      } finally {
        images.forEach(assets => { assets.avatar.release(); assets.background?.release(); });
        images.clear(); canvas.width = 1; canvas.height = 1;
      }
    }
    const blob = await encodePng(width, height, renderStrips(), signal);
    return { blob, previews, width, height, unavailableBackgrounds: plan.unavailableBackgrounds };
  } finally {
    images.forEach(assets => { assets.avatar.release(); assets.background?.release(); });
    images.clear(); canvas.width = 1; canvas.height = 1;
    previewCanvas.width = 1; previewCanvas.height = 1;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
