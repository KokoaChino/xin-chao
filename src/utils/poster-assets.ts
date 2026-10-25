import type { RosterEntry } from './display';
import { characterName, imageUrl } from './display';

export const ASSET_TIMEOUT_MS = 120_000;
export const ASSET_ATTEMPTS = 3;
export const ASSET_CONCURRENCY = 4;
const CACHE_BYTES = 96 * 1024 * 1024;
const CACHE_TTL = 30 * 60 * 1000;

export interface PosterAsset {
  url: string;
  label: string;
}
export interface AssetActivity {
  label: string;
  state: 'fetching' | 'retrying';
  attempt: number;
  elapsedSeconds: number;
  loadedBytes: number;
  totalBytes?: number;
}
export interface PosterProgress {
  phase: 'preparing' | 'assets' | 'rendering' | 'encoding';
  completed: number;
  total: number;
  message: string;
  activeAssets: AssetActivity[];
  unavailableBackgrounds: string[];
}
export interface PosterAssetFailure extends PosterAsset {
  reason: string;
  attempts: number;
}
export class PosterAssetsError extends Error {
  constructor(public failures: PosterAssetFailure[]) {
    super(`${failures.length}项素材未能完整加载，本次未生成海报。请检查网络或原图后重试。`);
    this.name = 'PosterAssetsError';
  }
}
export interface PreparedAsset {
  blob: Blob;
  width: number;
  height: number;
}
export interface PosterAssetPlan {
  tasks: PosterAsset[];
  rows: { avatar: string; background: string | null }[];
  unavailableBackgrounds: string[];
}

const assetCache = new Map<string, { asset: PreparedAsset; expiresAt: number }>();
let cacheSize = 0;
export function clearPosterAssetCache() { assetCache.clear(); cacheSize = 0; }

function cacheAsset(url: string, asset: PreparedAsset) {
  if (asset.blob.size > CACHE_BYTES) return;
  const existing = assetCache.get(url);
  if (existing) { cacheSize -= existing.asset.blob.size; assetCache.delete(url); }
  assetCache.set(url, { asset, expiresAt: Date.now() + CACHE_TTL }); cacheSize += asset.blob.size;
  while (cacheSize > CACHE_BYTES) {
    const oldest = assetCache.entries().next().value!;
    cacheSize -= oldest[1].asset.blob.size; assetCache.delete(oldest[0]);
  }
}
function cachedAsset(url: string): PreparedAsset | undefined {
  const cached = assetCache.get(url);
  if (!cached) return;
  if (cached.expiresAt <= Date.now()) {
    cacheSize -= cached.asset.blob.size; assetCache.delete(url); return;
  }
  assetCache.delete(url); assetCache.set(url, cached);
  return cached.asset;
}

export function planPosterAssets(entries: RosterEntry[], width: number): PosterAssetPlan {
  const tasks = new Map<string, PosterAsset>(), failures: PosterAssetFailure[] = [];
  const unavailableBackgrounds: string[] = [];
  const add = (raw: string, label: string, size: number) => {
    if (!raw.trim()) { failures.push({ url: raw, label, reason: '资料中没有提供图片地址', attempts: 0 }); return ''; }
    const url = imageUrl(raw, size);
    if (!tasks.has(url)) tasks.set(url, { url, label });
    return url;
  };
  const rows = entries.map(({ character: c }) => {
    const name = characterName(c), scale = width / 1080;
    const avatar = add(c.avatar.url, `${name} · 头像`, Math.min(c.avatar.width || Infinity, Math.max(360, Math.ceil(230 * scale * 1.25))));
    const background = c.poster
      ? add(c.poster.url, `${name} · 海报立绘`, Math.min(c.poster.width || Infinity, width)) : null;
    if (!c.poster) unavailableBackgrounds.push(name);
    return { avatar, background };
  });
  if (failures.length) throw new PosterAssetsError(failures);
  return { tasks: [...tasks.values()], rows, unavailableBackgrounds: [...new Set(unavailableBackgrounds)] };
}

export async function decodePosterAsset(blob: Blob, signal?: AbortSignal): Promise<{ image: HTMLImageElement; release: () => void }> {
  signal?.throwIfAborted();
  const image = new Image(), url = URL.createObjectURL(blob);
  image.decoding = 'async';
  const release = () => { image.src = ''; URL.revokeObjectURL(url); };
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException('已取消', 'AbortError')); };
      image.onload = () => {
        cleanup();
        if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve();
        else reject(new Error('图片内容没有有效像素'));
      };
      image.onerror = () => { cleanup(); reject(new Error('图片无法解码，来源可能返回了错误页面或损坏文件')); };
      signal?.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    signal?.throwIfAborted();
    return { image, release };
  } catch (error) { release(); throw error; }
}

class RequestFailure extends Error {
  constructor(message: string, public retryable = true) { super(message); }
}
interface AssetLoaderOptions {
  concurrency?: number;
  timeoutMs?: number;
  attempts?: number;
  retryDelays?: number[];
  fetcher?: typeof fetch;
  verify?: (blob: Blob, signal: AbortSignal) => Promise<{ width: number; height: number }>;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function preparePosterAssets(
  plan: PosterAssetPlan, onProgress?: (progress: PosterProgress) => void, signal?: AbortSignal, options: AssetLoaderOptions = {},
): Promise<Map<string, PreparedAsset>> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const jobSignal = controller.signal;
  const timeoutMs = options.timeoutMs ?? ASSET_TIMEOUT_MS, attempts = options.attempts ?? ASSET_ATTEMPTS;
  const fetcher = options.fetcher ?? fetch;
  const verify = options.verify ?? (async (blob, currentSignal) => {
    const decoded = await decodePosterAsset(blob, currentSignal);
    const dimensions = { width: decoded.image.naturalWidth, height: decoded.image.naturalHeight };
    decoded.release(); return dimensions;
  });
  const assets = new Map<string, PreparedAsset>(), active = new Map<string, AssetActivity & { startedAt: number }>();
  const failures: PosterAssetFailure[] = [];
  let next = 0, completed = 0, lastPublished = 0;
  const publish = (force = false) => {
    if (jobSignal.aborted) return;
    const now = Date.now();
    if (!force && now - lastPublished < 200) return;
    lastPublished = now;
    onProgress?.({
      phase: 'assets', completed, total: plan.tasks.length,
      message: `已就绪 ${assets.size}/${plan.tasks.length} 项素材${failures.length ? `，${failures.length}项失败` : ''}`,
      activeAssets: [...active.values()].map(({ startedAt, ...activity }) => ({ ...activity, elapsedSeconds: Math.floor((now - startedAt) / 1000) })),
      unavailableBackgrounds: plan.unavailableBackgrounds,
    });
  };

  async function request(task: PosterAsset, attempt: number, activity: AssetActivity): Promise<PreparedAsset> {
    jobSignal.throwIfAborted();
    const attemptController = new AbortController();
    const cancel = () => attemptController.abort(jobSignal.reason);
    jobSignal.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; attemptController.abort(); }, timeoutMs);
    try {
      const response = await fetcher(task.url, {
        signal: attemptController.signal, credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer',
        cache: attempt === 1 ? 'default' : 'reload',
      });
      if (!response.ok) throw new RequestFailure(`图片来源返回 HTTP ${response.status}`, ![400, 401, 403, 404, 410].includes(response.status));
      const size = Number(response.headers.get('Content-Length'));
      if (size > 0) activity.totalBytes = size;
      const parts: ArrayBuffer[] = [];
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            attemptController.signal.throwIfAborted();
            if (done) break;
            parts.push(value.slice().buffer);
            activity.loadedBytes += value.length; publish();
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      } else {
        const data = await response.arrayBuffer(); parts.push(data); activity.loadedBytes = data.byteLength;
      }
      const blob = new Blob(parts, { type: response.headers.get('Content-Type') || '' });
      if (!blob.size) throw new RequestFailure('图片来源返回了空文件');
      const dimensions = await verify(blob, attemptController.signal);
      attemptController.signal.throwIfAborted();
      return { blob, ...dimensions };
    } catch (error) {
      jobSignal.throwIfAborted();
      if (timedOut) throw new RequestFailure(`等待${Math.round(timeoutMs / 1000)}秒仍未完成`);
      if (error instanceof RequestFailure) throw error;
      if (error instanceof TypeError) throw new RequestFailure('无法连接图片来源，可能是网络中断或跨域访问被拒绝');
      throw new RequestFailure(error instanceof Error ? error.message : '图片请求失败');
    } finally {
      clearTimeout(timer); jobSignal.removeEventListener('abort', cancel);
    }
  }

  async function worker() {
    while (next < plan.tasks.length) {
      jobSignal.throwIfAborted();
      const task = plan.tasks[next++], cached = cachedAsset(task.url);
      if (cached) { assets.set(task.url, cached); completed++; publish(true); continue; }
      let failure: PosterAssetFailure | null = null;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        jobSignal.throwIfAborted();
        const activity = { label: task.label, state: 'fetching' as AssetActivity['state'], attempt, elapsedSeconds: 0, loadedBytes: 0, startedAt: Date.now() };
        active.set(task.url, activity); publish(true);
        try {
          const asset = await request(task, attempt, activity);
          assets.set(task.url, asset); cacheAsset(task.url, asset); failure = null; break;
        } catch (error) {
          jobSignal.throwIfAborted();
          failure = { ...task, reason: error instanceof Error ? error.message : '请求失败', attempts: attempt };
          if (attempt === attempts || (error instanceof RequestFailure && !error.retryable)) break;
          activity.state = 'retrying'; publish(true);
          await wait(options.retryDelays?.[attempt - 1] ?? [1000, 3000][attempt - 1] ?? 3000, jobSignal);
        }
      }
      active.delete(task.url);
      if (failure) failures.push(failure);
      completed++; publish(true);
      if (failure) { controller.abort(new PosterAssetsError([...failures])); return; }
    }
  }

  const ticker = setInterval(() => publish(), 1000);
  try {
    publish(true);
    const results = await Promise.allSettled(Array.from({ length: Math.min(Math.max(1, options.concurrency ?? ASSET_CONCURRENCY), plan.tasks.length) }, () => worker()));
    jobSignal.throwIfAborted();
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    if (failures.length) throw new PosterAssetsError(failures);
    if (assets.size !== plan.tasks.length) throw new Error('素材校验不完整，本次未生成海报。');
    return assets;
  } finally {
    clearInterval(ticker); signal?.removeEventListener('abort', abort);
    controller.abort(); active.clear();
    if (failures.length) assets.clear();
  }
}
