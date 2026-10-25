import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, AudioLines, BookOpen, Check, ChevronDown,
  ChevronLeft, ChevronRight, ExternalLink, Feather, Heart, Image as ImageIcon,
  LoaderCircle, Maximize2, RefreshCw, Shirt, Sparkles, Video, X,
} from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Artwork, ArtworkKind, Character, CharacterSummary, LoreEntry } from '../types';
import { imageUrl } from '../utils/display';
import SafeHtml from './SafeHtml';
import VoicePlayer from './VoicePlayer';
import OfficialVideos from './OfficialVideos';
import { uniqueVoices } from '../utils/voices';
import './CharacterDetail.css';

export interface CharacterDetailProps {
  summary: CharacterSummary;
  variants: CharacterSummary[];
  loadCharacter: (id: string) => Promise<Character>;
  onClose: () => void;
  onSelectVariant: (id: string) => void;
}

type DetailTab = 'overview' | 'archives' | 'treasures' | 'stories' | 'voices' | 'outfits' | 'videos';
interface LightboxState { images: Artwork[]; index: number }

const TABS: { id: DetailTab; label: string; icon: typeof BookOpen }[] = [
  { id: 'overview', label: '资料', icon: Sparkles },
  { id: 'archives', label: '档案', icon: BookOpen },
  { id: 'treasures', label: '珍贵之物', icon: Heart },
  { id: 'stories', label: '故事', icon: Feather },
  { id: 'voices', label: '语音', icon: AudioLines },
  { id: 'outfits', label: '皮肤', icon: Shirt },
  { id: 'videos', label: '影像', icon: Video },
];

const ART_LABELS: Record<ArtworkKind, string> = {
  team: '编队立绘', poster: '海报立绘', portrait: '角色立绘', skin: '服装立绘', other: '展示图',
};
const CV_LABELS: Record<string, string> = {
  zh: '中文配音', 'zh-CN': '中文配音', 'zh-Hans': '中文配音', cn: '中文配音', 中文: '中文配音',
  ja: '日文配音', 'ja-JP': '日文配音', jp: '日文配音', 日文: '日文配音', 日语: '日文配音',
  en: '英文配音', 'en-US': '英文配音', 英文: '英文配音', 英语: '英文配音',
  ko: '韩文配音', 'ko-KR': '韩文配音', kr: '韩文配音', 韩文: '韩文配音', 韩语: '韩文配音',
};
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function uniqueArtwork(images: (Artwork | null | undefined)[]) {
  const seen = new Set<string>();
  return images.filter((image): image is Artwork => {
    if (!image?.url || seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
}

function EmptySection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="detail-empty">{icon}<h3>{title}</h3><p>{children}</p></div>;
}

function LoreCollection({
  entries, kind, onImageClick,
}: { entries: LoreEntry[]; kind: 'archives' | 'treasures' | 'stories'; onImageClick: (url: string, label: string) => void }) {
  const [openId, setOpenId] = useState(entries[0]?.id ?? '');
  const activeId = openId === '__none__' ? '' : entries.some((entry) => entry.id === openId) ? openId : entries[0]?.id;
  const names = {
    archives: { title: '角色档案', empty: '档案尚未收录' },
    treasures: { title: '珍贵之物', empty: '珍贵之物尚未收录' },
    stories: { title: '角色故事', empty: '故事尚未收录' },
  }[kind];
  if (!entries.length) {
    return <EmptySection icon={<BookOpen size={30} strokeWidth={1.3} />} title={names.empty}>当前来源中没有可展示的完整内容。可以前往 Wiki 查看，或稍后刷新资料。</EmptySection>;
  }

  return (
    <section className={`detail-lore detail-lore--${kind}`}>
      <div className="detail-section-intro">
        <div><h3>{names.title}</h3></div>
        <span className="detail-small-meta">共 {entries.length} 篇</span>
      </div>
      <div className="detail-chapter-list">
        {entries.map((entry, index) => {
          const isOpen = entry.id === activeId;
          const bodyImages = (entry.images ?? []).filter((url) => !entry.html.includes(url));
          return (
            <article key={entry.id} className={`detail-chapter${isOpen ? ' is-open' : ''}`}>
              <h4>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? '__none__' : entry.id)}>
                  <span className="detail-chapter-number">{String(index + 1).padStart(2, '0')}</span>
                  <span>{entry.title}</span>
                  <ChevronDown size={18} aria-hidden="true" />
                </button>
              </h4>
              {isOpen && (
                <div className="detail-chapter-body">
                  {bodyImages.length > 0 && (
                    <div className="detail-lore-images">
                      {bodyImages.map((url, imageIndex) => (
                        <button type="button" key={url} onClick={() => onImageClick(url, entry.title)} aria-label={`放大查看${entry.title}图片${imageIndex + 1}`}>
                          <img src={imageUrl(url, 640)} alt={entry.title} loading="lazy" decoding="async" />
                          <Maximize2 size={15} />
                        </button>
                      ))}
                    </div>
                  )}
                  {entry.html
                    ? <SafeHtml html={entry.html} onImageClick={onImageClick} />
                    : <p className="detail-inline-empty">来源尚未提供这一篇的正文。</p>}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function CharacterDetail({
  summary, variants, loadCharacter, onClose, onSelectVariant,
}: CharacterDetailProps) {
  const [loadedCharacter, setLoadedCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [retry, setRetry] = useState(0);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [selectedOutfitId, setSelectedOutfitId] = useState('');
  const [selectedImage, setSelectedImage] = useState('');
  const [artFilter, setArtFilter] = useState<ArtworkKind>('team');
  const [artFailed, setArtFailed] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [lightboxFailed, setLightboxFailed] = useState(false);
  const [lightboxLoading, setLightboxLoading] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lightboxCloseRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const lightboxReturnFocusRef = useRef<HTMLElement | null>(null);
  const callbacksRef = useRef({ onClose, loadCharacter });
  const lightboxRef = useRef(lightbox);
  const titleId = useId();
  const tabPrefix = useId();
  callbacksRef.current = { onClose, loadCharacter };
  lightboxRef.current = lightbox;
  const character = loadedCharacter?.id === summary.id ? loadedCharacter : null;
  const data = character ?? summary;

  useEffect(() => {
    let live = true;
    const hasExistingDetail = loadedCharacter?.id === summary.id;
    setLoading(!hasExistingDetail);
    setError('');
    setRefreshError('');
    callbacksRef.current.loadCharacter(summary.id).then((result) => {
      if (!live) return;
      setLoadedCharacter(result);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (!live) return;
      const message = reason instanceof Error ? reason.message : '角色资料暂时无法读取。';
      if (hasExistingDetail) setRefreshError('本次更新暂未读取，仍展示上次收录的资料。');
      else setError(message);
      setLoading(false);
    });
    return () => { live = false; };
  }, [summary.id, summary.fetchedAt, retry]);

  useEffect(() => {
    setActiveTab('overview');
    setSelectedOutfitId('');
    setSelectedImage('');
    setArtFilter('team');
    setLightbox(null);
    if (contentRef.current) contentRef.current.scrollTop = 0;
    if (dialogRef.current) dialogRef.current.scrollTop = 0;
  }, [summary.id]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    closeRef.current?.focus({ preventScroll: true });

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (lightboxRef.current) setLightbox(null);
        else callbacksRef.current.onClose();
        return;
      }
      if (lightboxRef.current && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        setLightbox((current) => current ? {
          ...current,
          index: (current.index + (event.key === 'ArrowRight' ? 1 : -1) + current.images.length) % current.images.length,
        } : current);
        return;
      }
      if (event.key !== 'Tab') return;
      const container = lightboxRef.current
        ? dialogRef.current?.querySelector<HTMLElement>('.detail-lightbox')
        : dialogRef.current;
      if (!container) return;
      const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      const previous = returnFocusRef.current;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (lightbox) {
      if (!lightboxReturnFocusRef.current) {
        lightboxReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      lightboxCloseRef.current?.focus({ preventScroll: true });
    } else if (lightboxReturnFocusRef.current) {
      lightboxReturnFocusRef.current.focus({ preventScroll: true });
      lightboxReturnFocusRef.current = null;
    }
  }, [Boolean(lightbox)]);

  const outfits = character?.outfits ?? [];
  const selectedOutfit = outfits.find((outfit) => outfit.id === selectedOutfitId) ?? outfits[0];
  const outfitGallery = useMemo(() => uniqueArtwork(selectedOutfit?.images ?? []).sort((left, right) => {
    const leftIsPrimary = /皮肤立绘|编队立绘/.test(left.label) ? 1 : 0;
    const rightIsPrimary = /皮肤立绘|编队立绘/.test(right.label) ? 1 : 0;
    return rightIsPrimary - leftIsPrimary || (right.width ?? 0) * (right.height ?? 0) - (left.width ?? 0) * (left.height ?? 0);
  }), [selectedOutfit]);
  const gallery = useMemo(() => {
    if (activeTab === 'outfits' && selectedOutfit) return outfitGallery;
    return uniqueArtwork([data.hero, data.poster, ...(character?.artworks ?? []).filter((art) => art.kind !== 'skin')]);
  }, [activeTab, selectedOutfit, outfitGallery, data.hero, data.poster, character?.artworks]);
  const artCategories = (['team', 'poster', 'portrait', 'skin', 'other'] as const).filter((kind) => gallery.some((art) => art.kind === kind));
  const effectiveFilter = artCategories.includes(artFilter) ? artFilter : artCategories[0];
  const filteredGallery = gallery.filter((art) => art.kind === effectiveFilter);
  const artwork = filteredGallery.find((art) => art.url === selectedImage) ?? filteredGallery[0];
  const galleryIndex = gallery.findIndex((art) => art.url === artwork?.url);
  const currentLightboxArt = lightbox?.images[lightbox.index];
  useEffect(() => setArtFailed(false), [artwork?.url]);
  useEffect(() => {
    setLightboxFailed(false);
    setLightboxLoading(true);
  }, [currentLightboxArt?.url]);

  const openImage = useCallback((url: string, label: string) => {
    setLightbox({ images: [{ url, label, kind: 'other' }], index: 0 });
  }, []);

  function switchTab(tab: DetailTab) {
    setActiveTab(tab);
    setSelectedImage('');
    if (contentRef.current) contentRef.current.scrollTop = 0;
    const dialog = dialogRef.current;
    const content = contentRef.current;
    if (dialog && content && window.matchMedia('(max-width: 720px)').matches) {
      const tabs = dialog.querySelector<HTMLElement>('.detail-tabs');
      const contentTop = content.getBoundingClientRect().top - dialog.getBoundingClientRect().top + dialog.scrollTop;
      dialog.scrollTop = Math.min(dialog.scrollTop, Math.max(0, contentTop - (tabs?.offsetHeight ?? 50)));
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    else return;
    event.preventDefault();
    switchTab(TABS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  const fields = [
    ['共鸣能力', data.resonanceName],
    ['性别', data.gender],
    ['出生', data.origin],
    ['武器', data.weapon],
    ['属性', data.element],
    ['身份', character?.identity],
    ['所属', data.affiliation],
    ['特殊料理', character?.specialty],
    ['实装版本', data.releaseVersion],
  ].filter(([, value]) => value);
  const allOutfitVoices = useMemo(() => {
    if (!selectedOutfit) return [];
    const voices = [...selectedOutfit.voices, ...(character?.voices ?? []).filter((voice) => voice.outfitId === selectedOutfit.id)];
    const seen = new Set<string>();
    return voices.filter((voice) => {
      const key = `${voice.language}:${voice.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [selectedOutfit, character?.voices]);
  const voiceCounts = character ? uniqueVoices(character.voices).length : data.voiceCount;

  return (
    <div className="character-detail-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="character-detail" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="detail-dialog-shell" aria-hidden={lightbox ? true : undefined} inert={lightbox ? true : undefined}>
          <button type="button" className="detail-close" ref={closeRef} onClick={onClose} aria-label="关闭角色资料">
            <X size={20} /><span>关闭</span>
          </button>
          <aside className={`detail-art-panel${artwork?.kind === 'poster' ? ' detail-art-panel--poster' : ''}`} aria-label="角色立绘">
            <div className="detail-art-heading"><span>角色立绘</span></div>
            <div className="detail-art-watermark" aria-hidden="true">{data.romanizedName}</div>
            <div className="detail-art-orbit" aria-hidden="true" />
            <div className="detail-art-orbit detail-art-orbit--inner" aria-hidden="true" />
            {artwork && !artFailed ? (
              <button type="button" className={`detail-art-image-button${artwork.kind === 'poster' ? ' is-poster' : ''}`} onClick={() => setLightbox({ images: gallery, index: Math.max(0, galleryIndex) })} aria-label={`放大查看${artwork.label || ART_LABELS[artwork.kind]}`}>
                <img key={artwork.url} className="detail-main-art" src={imageUrl(artwork.url, 1000)} alt={`${activeTab === 'outfits' && selectedOutfit ? selectedOutfit.name : data.displayName} · ${artwork.label || ART_LABELS[artwork.kind]}`} decoding="async" onError={() => setArtFailed(true)} />
                <span className="detail-art-expand"><Maximize2 size={15} />查看原图</span>
              </button>
            ) : (
              <div className="detail-art-unavailable">
                <ImageIcon size={34} strokeWidth={1} />
                <span>{artFailed ? '图片暂时未能加载' : activeTab === 'outfits' && selectedOutfit ? '这套服装尚未收录立绘' : '立绘尚未收录'}</span>
                {artFailed && <button type="button" onClick={() => setArtFailed(false)}><RefreshCw size={14} />重试</button>}
              </div>
            )}
            <div className="detail-art-bottom">
              <div className="detail-art-caption">
                <span>{activeTab === 'outfits' && selectedOutfit ? selectedOutfit.name : data.displayName}</span>
                <span>{artwork?.width && artwork?.height ? `${artwork.width} × ${artwork.height}` : artwork?.label || '角色立绘'}</span>
              </div>
              {artCategories.length > 0 && (
                <div className="detail-art-types" aria-label="立绘类型">
                  {artCategories.map((kind) => (
                    <button key={kind} type="button" className={effectiveFilter === kind ? 'is-selected' : ''} aria-pressed={effectiveFilter === kind} onClick={() => { setArtFilter(kind); setSelectedImage(''); }}>
                      {ART_LABELS[kind]}
                    </button>
                  ))}
                </div>
              )}
              {filteredGallery.length > 1 && (
                <div className="detail-art-thumbnails" aria-label="选择立绘">
                  {filteredGallery.map((art, index) => (
                    <button type="button" key={art.url} className={artwork?.url === art.url ? 'is-selected' : ''} aria-pressed={artwork?.url === art.url} aria-label={`${art.label || ART_LABELS[art.kind]} ${index + 1}`} onClick={() => setSelectedImage(art.url)}>
                      <img src={imageUrl(art.url, 160)} alt="" loading="lazy" decoding="async" />
                      <span>{art.orientation === 'mobile' ? '竖版' : art.orientation === 'desktop' ? '横版' : String(index + 1).padStart(2, '0')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
          <div className="detail-reading-panel">
            <header className="detail-header">
              <div className="detail-header-topline">
                
                {data.isPreview && <span className="detail-preview-badge">预告角色</span>}
              </div>
              <div className="detail-name-line">
                <h2 id={titleId}>{data.name || data.displayName}</h2>
                <span className="detail-name-flourish" aria-hidden="true">✦</span>
              </div>
              {data.romanizedName && <p className="detail-romanized">{data.romanizedName}</p>}
              {variants.length > 1 && (
                <label className="detail-variant-select">
                  <span>共鸣形态</span>
                  <select aria-label="切换角色形态" value={summary.id} onChange={(event) => onSelectVariant(event.target.value)}>
                    {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.displayName}{variant.element && !variant.displayName.includes(variant.element) ? ` · ${variant.element}` : ''}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </label>
              )}

            </header>
            <div className="detail-tabs" role="tablist" aria-label="角色资料栏目">
              {TABS.map((tab, index) => {
                const Icon = tab.icon;
                const count = tab.id === 'outfits' ? outfits.length : tab.id === 'voices' ? voiceCounts : 0;
                return (
                  <button
                    key={tab.id}
                    ref={(element) => { tabRefs.current[index] = element; }}
                    type="button"
                    role="tab"
                    id={`${tabPrefix}-${tab.id}`}
                    aria-controls={`${tabPrefix}-panel`}
                    aria-selected={activeTab === tab.id}
                    tabIndex={activeTab === tab.id ? 0 : -1}
                    className={activeTab === tab.id ? 'is-selected' : ''}
                    onClick={() => switchTab(tab.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                  >
                    <Icon size={15} strokeWidth={1.7} /><span>{tab.label}</span>{count > 0 && <small>{count}</small>}
                  </button>
                );
              })}
            </div>
            <div className="detail-content-scroll" ref={contentRef}>
              <div role="tabpanel" id={`${tabPrefix}-panel`} aria-labelledby={`${tabPrefix}-${activeTab}`} className="detail-tab-panel" key={`${summary.id}-${activeTab}`}>
                {loading && activeTab !== 'overview' ? (
                  <div className="detail-loading" role="status"><LoaderCircle size={24} className="detail-spin" /><p>正在加载资料…</p><div className="detail-skeleton-line" /><div className="detail-skeleton-line" /><div className="detail-skeleton-line" /></div>
                ) : error && activeTab !== 'overview' ? (
                  <div className="detail-load-error" role="alert"><BookOpen size={30} strokeWidth={1.3} /><h3>这一页暂时未能打开</h3><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={15} />重新读取</button></div>
                ) : (
                  <>
                    {activeTab === 'overview' && (
                      <div className="detail-overview">
                        <div className="detail-introduction">
                          
                          {data.resonanceName && <h3>{data.resonanceName}</h3>}
                          <p>{data.description || '暂无简介。'}</p>
                          
                        </div>
                        <section className="detail-facts" aria-label="基础资料">
                          <div className="detail-mini-heading"><span>基础信息</span></div>
                          <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                          {loading && <p className="detail-loading-inline"><LoaderCircle size={13} className="detail-spin" />正在读取完整资料</p>}
                          {error && <p className="detail-loading-inline">完整资料暂未读取。<button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></p>}
                        </section>
                        {character && Object.values(character.cv).some(Boolean) && (
                          <section className="detail-cv" aria-label="角色配音">
                            <div className="detail-mini-heading"><span>配音演员</span></div>
                            <dl>{Object.entries(character.cv).filter(([, value]) => value).map(([language, name]) => <div key={language}><dt>{CV_LABELS[language] || (language.includes('CV') ? language : `${language}配音`)}</dt><dd>{name}</dd></div>)}</dl>
                          </section>
                        )}

                      </div>
                    )}
                    {activeTab === 'archives' && <LoreCollection entries={character?.archives ?? []} kind="archives" onImageClick={openImage} />}
                    {activeTab === 'treasures' && <LoreCollection entries={character?.treasures ?? []} kind="treasures" onImageClick={openImage} />}
                    {activeTab === 'stories' && <LoreCollection entries={character?.stories ?? []} kind="stories" onImageClick={openImage} />}
                    {activeTab === 'voices' && <VoicePlayer voices={character?.voices ?? []} />}
                    {activeTab === 'videos' && <OfficialVideos character={data} />}
                    {activeTab === 'outfits' && (
                      outfits.length ? (
                        <section className="detail-outfits">
                          <div className="detail-section-intro"><div><h3>角色皮肤</h3></div><span className="detail-small-meta">{outfits.length} 套皮肤</span></div>
                          <div className="detail-outfit-select" aria-label="选择角色服装">
                            {outfits.map((outfit, index) => <button key={outfit.id} type="button" className={selectedOutfit?.id === outfit.id ? 'is-selected' : ''} aria-pressed={selectedOutfit?.id === outfit.id} onClick={() => { setSelectedOutfitId(outfit.id); setSelectedImage(''); setArtFilter('team'); }}><span>{String(index + 1).padStart(2, '0')}</span>{outfit.name}{selectedOutfit?.id === outfit.id && <Check size={14} />}</button>)}
                          </div>
                          {selectedOutfit && <div className="detail-outfit-body" key={selectedOutfit.id}>
                            <div className="detail-outfit-title"><Shirt size={22} strokeWidth={1.3} /><h4>{selectedOutfit.name}</h4></div>
                            {selectedOutfit.descriptionHtml ? <SafeHtml html={selectedOutfit.descriptionHtml} onImageClick={openImage} textOnlyTables /> : <p className="detail-inline-empty">来源尚未提供这套服装的介绍。</p>}
                            {outfitGallery.length > 0 ? (
                              <div className="detail-outfit-gallery">
                                {outfitGallery.map((art, index) => <button type="button" key={`${art.url}-${index}`} onClick={() => setLightbox({ images: outfitGallery, index })} aria-label={`放大查看${selectedOutfit.name} ${art.label || ART_LABELS[art.kind]}`}><img src={imageUrl(art.url, 640)} alt={`${selectedOutfit.name} · ${art.label || ART_LABELS[art.kind]}`} loading="lazy" decoding="async" /><span>{art.label || ART_LABELS[art.kind]}<Maximize2 size={13} /></span></button>)}
                              </div>
                            ) : <p className="detail-inline-empty">这套服装的立绘尚未收录。</p>}
                            {allOutfitVoices.length > 0 ? <VoicePlayer key={selectedOutfit.id} voices={allOutfitVoices} compact /> : <p className="detail-footnote">当前来源未提供这套服装的专属语音。</p>}
                          </div>}
                        </section>
                      ) : <EmptySection icon={<Shirt size={30} strokeWidth={1.3} />} title="暂无额外皮肤">当前来源尚未收录额外服装。新增的服装资料会随角色数据更新。</EmptySection>
                    )}
                  </>
                )}
                <footer className="detail-source-footer">
                  
                  {data.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer">资料来源<ExternalLink size={12} /></a>}
                  {data.fetchedAt && <p>资料收录于 {new Date(data.fetchedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}</p>}
                  {refreshError && <p className="detail-refresh-notice" role="status">{refreshError}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></p>}
                  
                </footer>
              </div>
            </div>
          </div>
        </div>
        {lightbox && currentLightboxArt && (
          <div className="detail-lightbox" role="dialog" aria-modal="true" aria-label="图片原图预览" tabIndex={-1}>
            <div className="detail-lightbox-toolbar">
              <button type="button" ref={lightboxCloseRef} onClick={() => setLightbox(null)}><ArrowLeft size={18} /><span>返回资料</span></button>
              <span>{currentLightboxArt.label || ART_LABELS[currentLightboxArt.kind]}{lightbox.images.length > 1 ? ` · ${lightbox.index + 1} / ${lightbox.images.length}` : ''}</span>
              <a href={currentLightboxArt.url} target="_blank" rel="noopener noreferrer" aria-label="在新标签页打开原图"><ExternalLink size={18} /></a>
            </div>
            <div className="detail-lightbox-stage">
              {lightboxFailed ? <div className="detail-art-unavailable"><ImageIcon size={34} strokeWidth={1} /><span>原图暂时未能加载</span><button type="button" onClick={() => { setLightboxFailed(false); setLightboxLoading(true); }}><RefreshCw size={14} />重试</button></div> : <>
                {lightboxLoading && <div className="detail-lightbox-loading" role="status"><LoaderCircle className="detail-spin" size={25} /><span>正在加载高清原图</span></div>}
                <img key={currentLightboxArt.url} src={currentLightboxArt.url} alt={currentLightboxArt.label || '角色原图'} style={{ opacity: lightboxLoading ? 0 : 1 }} onLoad={() => setLightboxLoading(false)} onError={() => { setLightboxFailed(true); setLightboxLoading(false); }} />
              </>}
              {lightbox.images.length > 1 && <>
                <button type="button" className="detail-lightbox-prev" aria-label="上一张图片" onClick={() => setLightbox((current) => current ? { ...current, index: (current.index - 1 + current.images.length) % current.images.length } : current)}><ChevronLeft size={24} /></button>
                <button type="button" className="detail-lightbox-next" aria-label="下一张图片" onClick={() => setLightbox((current) => current ? { ...current, index: (current.index + 1) % current.images.length } : current)}><ChevronRight size={24} /></button>
              </>}
            </div>
            <p className="detail-lightbox-caption">{data.displayName}{currentLightboxArt.width && currentLightboxArt.height ? ` · ${currentLightboxArt.width} × ${currentLightboxArt.height}` : ''}<span>图片由官方素材源提供</span></p>
          </div>
        )}
      </div>
    </div>
  );
}
