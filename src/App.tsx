import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Film, Image, LoaderCircle, Upload, X } from 'lucide-react';
import { useCatalog } from './hooks/useCatalog';
import { usePreferences } from './hooks/usePreferences';
import { groupRoster } from './utils/display';
import type { RosterEntry } from './utils/display';
import { exportRanking, importRanking, rankingTitle } from './utils/backup';
import { createRankingPoster, downloadBlob, PosterAssetsError, type PosterProgress, type PosterAssetFailure } from './utils/poster';
import CatalogGrid from './components/CatalogGrid';
import RankBoard from './components/RankBoard';
import CharacterDetail from './components/CharacterDetail';
import Spotlight from './components/Spotlight';
import Dialog from './components/Dialog';
import OfficialVideos from './components/OfficialVideos';

type Modal = 'poster' | 'videos' | 'import' | null;
const initialPosterProgress = (total: number): PosterProgress => ({ phase: 'preparing', completed: 0, total, message: '正在准备海报', activeAssets: [], unavailableBackgrounds: [] });
function assetBytes(value: number) { return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`; }
export default function App() {
  const catalog = useCatalog(); const pref = usePreferences();
  const [page, setPage] = useState<'ranking' | 'catalog'>('ranking');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<{ message: string; id: number } | null>(null);
  const [importText, setImportText] = useState(''); const [importName, setImportName] = useState(''); const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false); const [exportProgress, setExportProgress] = useState<PosterProgress>(() => initialPosterProgress(0));
  const [poster, setPoster] = useState<{ blob: Blob; width: number; height: number; unavailableBackgrounds: string[]; previews: { url: string; width: number; height: number }[] } | null>(null);
  const [exportTitle, setExportTitle] = useState(''); const [exportError, setExportError] = useState('');
  const [exportFailures, setExportFailures] = useState<PosterAssetFailure[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null); const toastId = useRef(0); const exportJob = useRef(0); const exportBusy = useRef(false);
  const exportController = useRef<AbortController | null>(null);
  const entries = useMemo(() => groupRoster(catalog.characters, pref.preferences.selectedVariants), [catalog.characters, pref.preferences.selectedVariants]);
  const entryMap = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries]);
  const rankedEntries = useMemo(() => pref.preferences.order.map(id => entryMap.get(id)).filter((entry): entry is RosterEntry => Boolean(entry)), [pref.preferences.order, entryMap]);
  const activeCharacter = catalog.characters.find(character => character.id === selectedId);
  const activeEntry = activeCharacter ? entryMap.get(activeCharacter.identityId || activeCharacter.id) : undefined;
  const activeLocked = activeEntry && pref.preferences.order.includes(activeEntry.id) && activeEntry.variants.some(variant => variant.name === '秧秧');
  const title = rankingTitle(pref.preferences.title);
  const featured = entryMap.get(featuredId || '') || entries.find(entry => entry.character.name === '今汐') || entries[0];
  const showToast = useCallback((message: string) => setToast({ message, id: ++toastId.current }), []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 4000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => () => { ++exportJob.current; exportBusy.current = false; exportController.current?.abort(); }, []);
  useEffect(() => () => { poster?.previews.forEach(preview => URL.revokeObjectURL(preview.url)); }, [poster]);
  useEffect(() => { if (pref.error) showToast(pref.error); }, [pref.error, showToast]);
  const selectVariant = (identityId: string, variantId: string) => {
    const entry = entryMap.get(identityId);
    if (!pref.ready || !entry?.variants.some(v => v.id === variantId)) return;
    pref.update(current => current.order.includes(identityId) && entry.variants.some(v => v.name === '秧秧') ? current
      : { ...current, selectedVariants: { ...current.selectedVariants, [identityId]: variantId } });
  };
  const removeFromRank = (id: string) => { if (pref.ready) { pref.remove(id); showToast('已移出榜单'); } };
  const toggleRank = (entry: RosterEntry) => {
    if (!pref.ready) return;
    if (pref.preferences.order.includes(entry.id)) removeFromRank(entry.id);
    else {
      pref.update(current => current.order.includes(entry.id) ? current : { ...current, order: [...current.order, entry.id], selectedVariants: { ...current.selectedVariants, [entry.id]: entry.character.id } });
      showToast('已加入榜单');
    }
  };
  const cycle = (direction: number) => { if (featured && entries.length) setFeaturedId(entries[(entries.findIndex(e => e.id === featured.id) + direction + entries.length) % entries.length].id); };
  const backup = () => {
    try { downloadBlob(new Blob([exportRanking(pref.preferences, entries)], { type: 'application/json' }), `${title}.json`); showToast('榜单已导出'); }
    catch (error) { showToast(error instanceof Error ? error.message : '导出失败。'); }
  };
  const readImport = async (file?: File) => {
    if (!file) return;
    try { if (file.size > 1024 * 1024) throw new Error('文件不能超过 1 MB。'); const text = await file.text(); importRanking(text, entries); setImportText(text); setImportName(file.name); setModal('import'); }
    catch (error) { showToast(error instanceof Error ? error.message : '文件格式不正确。'); }
    if (uploadRef.current) uploadRef.current.value = '';
  };
  const importBackup = async () => {
    if (importing) return; setImporting(true);
    try { await pref.importPreferences(importRanking(importText, entries)); setModal(null); showToast('榜单已导入'); }
    catch (error) { showToast(error instanceof Error ? error.message : '导入失败，原榜单已保留。'); }
    finally { setImporting(false); }
  };
  const closePoster = () => {
    ++exportJob.current; exportBusy.current = false;
    exportController.current?.abort(); exportController.current = null;
    setExporting(false); setPoster(null); setExportError(''); setExportFailures([]); setModal(null);
  };
  const createPoster = async () => {
    if (exportBusy.current || !rankedEntries.length) return;
    exportBusy.current = true; const job = ++exportJob.current;
    const controller = new AbortController(); exportController.current = controller;
    setModal('poster'); setPoster(null); setExportError(''); setExportFailures([]); setExportTitle(title);
    setExporting(true); setExportProgress(initialPosterProgress(rankedEntries.length));
    try {
      const result = await createRankingPoster(rankedEntries, pref.preferences, progress => { if (job === exportJob.current) setExportProgress(progress); }, controller.signal);
      if (job !== exportJob.current) return;
      setPoster({ blob: result.blob, width: result.width, height: result.height, unavailableBackgrounds: result.unavailableBackgrounds, previews: result.previews.map(preview => ({ url: URL.createObjectURL(preview.blob), width: preview.width, height: preview.height })) });
    } catch (error) { if (job === exportJob.current) { setExportError(error instanceof Error ? error.message : '海报生成失败。'); setExportFailures(error instanceof PosterAssetsError ? error.failures : []); } }
    finally { if (job === exportJob.current) { exportController.current = null; exportBusy.current = false; setExporting(false); } }
  };
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳转到主要内容</a>
    <header className="site-header"><span className="brand"><svg viewBox="0 0 36 36" aria-hidden="true"><path d="M5 18h6l4-11 7 22 4-11h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>心潮</span>
      <nav className="main-nav" role="tablist" aria-label="主要导航" onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 'ranking' : event.key === 'End' ? 'catalog' : page === 'ranking' ? 'catalog' : 'ranking'; setPage(next); document.getElementById(`${next}-tab`)?.focus(); }}>
        <button id="ranking-tab" role="tab" tabIndex={page === 'ranking' ? 0 : -1} aria-controls="ranking-panel" aria-selected={page === 'ranking'} className={page === 'ranking' ? 'active' : ''} onClick={() => setPage('ranking')}>我的榜单</button>
        <button id="catalog-tab" role="tab" tabIndex={page === 'catalog' ? 0 : -1} aria-controls="catalog-panel" aria-selected={page === 'catalog'} className={page === 'catalog' ? 'active' : ''} onClick={() => setPage('catalog')}>全部共鸣者</button>
      </nav><span className="header-spacer" />
    </header>
    <main id="main-content" className="page-container">
      <section id="ranking-panel" role="tabpanel" aria-labelledby="ranking-tab" hidden={page !== 'ranking'}>
        <Spotlight title={title} character={rankedEntries[0]?.character} onOpen={() => rankedEntries[0] && setSelectedId(rankedEntries[0].character.id)} />
        <div className="board-toolbar"><span>{rankedEntries.length} 位共鸣者</span><div><button className="button button-outline" disabled={!pref.ready} onClick={backup}><Download size={15} />导出榜单</button><button className="button button-outline" disabled={!pref.ready || catalog.loading} onClick={() => uploadRef.current?.click()}><Upload size={15} />导入榜单</button><button className="button button-dark" onClick={() => void createPoster()} disabled={exporting || !rankedEntries.length}>{exporting ? <LoaderCircle className="spin" size={16} /> : <Image size={16} />}{exporting ? `正在生成 ${exportProgress.completed}/${exportProgress.total}` : '分享海报'}</button></div></div>
        <RankBoard entries={rankedEntries} ready={pref.ready} onOpen={entry => setSelectedId(entry.character.id)} onReorder={pref.reorder} onRemove={removeFromRank} />
      </section>
      <section id="catalog-panel" role="tabpanel" aria-labelledby="catalog-tab" hidden={page !== 'catalog'}>
        <Spotlight title="全部共鸣者" character={featured?.character} position={featured ? entries.findIndex(e => e.id === featured.id) : 0} count={entries.length} onPrevious={() => cycle(-1)} onNext={() => cycle(1)} onOpen={() => featured && setSelectedId(featured.character.id)} />
        <div className="catalog-library-entry"><button className="button button-outline" onClick={() => setModal('videos')}><Film size={16} />全部角色影像</button></div>
        <CatalogGrid entries={entries} ranked={pref.preferences.order} ready={pref.ready} onOpen={entry => setSelectedId(entry.character.id)} onToggleRank={toggleRank} onVariant={selectVariant} />
      </section>
      {catalog.loading && !entries.length && <div className="initial-loading" role="status"><LoaderCircle className="spin" size={20} />正在加载角色资料</div>}
      {!catalog.loading && !entries.length && <div className="initial-error">资料暂时无法读取，请稍后重新打开页面。</div>}
    </main>
    <footer className="site-footer page-container">非官方作品 · 角色素材归库洛游戏及相关权利方所有</footer>
    {toast && <div className="toast" role="status"><Check size={15} /><span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button></div>}
    {activeCharacter && activeEntry && <CharacterDetail summary={activeCharacter} variants={activeLocked ? [activeEntry.character] : activeEntry.variants} loadCharacter={catalog.getCharacter} onClose={() => setSelectedId(null)} onSelectVariant={id => { if (!activeLocked) { selectVariant(activeEntry.id, id); setSelectedId(id); } }} />}
    {modal === 'import' && <Dialog title="导入榜单" onClose={() => { if (!importing) setModal(null); }}><p className="import-file">{importName}</p><p className="helper-text">导入将替换当前榜单。</p><div className="dialog-actions"><button className="button button-outline" onClick={backup}>先导出当前榜单</button><button className="button button-dark" disabled={importing} onClick={() => void importBackup()}>{importing ? '导入中…' : '确认导入'}</button></div></Dialog>}
    {modal === 'poster' && <Dialog title="海报预览" onClose={closePoster} className="export-dialog">
      {exporting && <div className="poster-loading">
        <LoaderCircle className="spin" size={25} />
        <p className="poster-progress-title" role="status">{exportProgress.phase === 'assets' ? '正在拉取素材' : '正在生成预览'} {exportProgress.completed}/{exportProgress.total}</p>
        <progress aria-label="海报生成进度" value={exportProgress.completed} max={Math.max(1, exportProgress.total)} />
        <span className="poster-progress-message">{exportProgress.message}</span>
        {!!exportProgress.activeAssets.length && <ul className="poster-active-assets" aria-label="正在拉取的素材">{exportProgress.activeAssets.map(asset => <li key={asset.label}>
          <span>{asset.state === 'retrying' ? '准备重试' : '拉取'} {asset.label}</span>
          <small>{asset.attempt > 1 ? `第${asset.attempt}次尝试 · ` : ''}{assetBytes(asset.loadedBytes)}{asset.totalBytes ? ` / ${assetBytes(asset.totalBytes)}` : ''} · 已等待{asset.elapsedSeconds}秒</small>
        </li>)}</ul>}
        <button className="button button-outline" onClick={closePoster}>取消生成</button>
      </div>}
      {exportError && <><div className="inline-warning poster-error" role="alert"><p>{exportError}</p>
        {!!exportFailures.length && <ul>{exportFailures.map((failure, index) => <li key={`${failure.url}-${index}`}><strong>{failure.label}</strong><span>{failure.reason}（已尝试{failure.attempts}次）</span>{failure.url && <a href={failure.url} target="_blank" rel="noopener noreferrer">查看原图</a>}</li>)}</ul>}
      </div><button className="button button-dark full-button" onClick={() => void createPoster()}>重新生成</button></>}
      {poster && <div className="poster-pages"><div>
        <div className="poster-preview" tabIndex={0} role="region" aria-label={`${exportTitle}海报预览`}>
          {poster.previews.map((preview, index) => <img key={preview.url} src={preview.url} width={preview.width} height={preview.height} style={{ height: 'auto' }} alt={index === 0 ? `${exportTitle}海报预览` : ''} loading="lazy" />)}
        </div>
        <p className="poster-resolution">{poster.width} × {poster.height} 像素</p>
        {!!poster.unavailableBackgrounds.length && <details className="poster-source-note"><summary>{poster.unavailableBackgrounds.length}位角色的来源未提供海报立绘</summary><p>{poster.unavailableBackgrounds.join('、')}</p></details>}
        <button className="button button-dark full-button" onClick={() => downloadBlob(poster.blob, `${exportTitle}.png`)}><Download size={16} />下载海报</button>
      </div></div>}
    </Dialog>}
    {modal === 'videos' && <Dialog title="全部角色影像" onClose={() => setModal(null)} className="video-library-dialog"><OfficialVideos /></Dialog>}
    <input ref={uploadRef} className="visually-hidden" tabIndex={-1} type="file" accept=".json,application/json" aria-label="导入榜单文件" onChange={event => void readImport(event.target.files?.[0])} />
  </div>;
}
