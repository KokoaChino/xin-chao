import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, Play, RotateCcw, Search, X } from 'lucide-react';
import type { CharacterSummary } from '../types';
import { VIDEO_CATEGORIES, type VideoCategory } from '../utils/video-classification';

export interface OfficialVideo {
  bvid: string; title: string; cover: string; duration: string; publishedLabel: string;
  category: VideoCategory; characterNames: string[]; url: string;
  sources?: { mid: string; name: string }[];
}
interface VideoIndex { schemaVersion: 1; ownerMid: string; videos: OfficialVideo[] }
let videoCache: Promise<VideoIndex> | null = null;
export function loadOfficialVideos(): Promise<VideoIndex> {
  if (!videoCache) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    videoCache = fetch(`${import.meta.env.BASE_URL}data/videos.json`, { credentials: 'omit', signal: controller.signal }).then(async response => {
    if (!response.ok) throw new Error('视频目录暂时无法加载。');
    const data = await response.json() as VideoIndex;
    if (data.schemaVersion !== 1 || data.ownerMid !== '1955897084' || !Array.isArray(data.videos)) throw new Error('视频目录校验失败。');
    return { ...data, videos: data.videos.filter(video => /^BV[A-Za-z0-9]{10}$/.test(video.bvid) && Array.isArray(video.characterNames) && typeof video.title === 'string') };
    }).catch(error => { videoCache = null; throw error; }).finally(() => window.clearTimeout(timer));
  }
  return videoCache;
}
export function matchingVideos(videos: OfficialVideo[], character: Pick<CharacterSummary, 'name' | 'identityId' | 'id'>): OfficialVideo[] {
  return videos.filter(video => video.characterNames.includes(character.name));
}
export function bilibiliPlayerUrl(bvid: string): string {
  if (!/^BV[A-Za-z0-9]{10}$/.test(bvid)) throw new Error('视频标识无效。');
  return `https://player.bilibili.com/player.html?bvid=${bvid}&page=1&autoplay=0&danmaku=0&high_quality=1`;
}

export default function OfficialVideos({ character }: { character?: CharacterSummary }) {
  const [index, setIndex] = useState<VideoIndex | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setError('');
    loadOfficialVideos().then(result => { if (live) setIndex(result); }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : '视频目录暂时无法加载。'); });
    return () => { live = false; };
  }, [retry]);
  useEffect(() => { setActive(null); setCategory(''); setQuery(''); }, [character?.id]);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => playerRef.current?.scrollIntoView({
      block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    }));
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const videos = useMemo(() => character ? matchingVideos(index?.videos || [], character) : index?.videos || [], [index, character]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searched = videos.filter(video => !normalizedQuery || `${video.title} ${video.characterNames.join(' ')} ${video.category}`.toLocaleLowerCase().includes(normalizedQuery));
  const filtered = category ? searched.filter(video => video.category === category) : searched;
  const categories = VIDEO_CATEGORIES.filter(value => videos.some(video => video.category === value));
  const groups = !character && !category
    ? categories.map(value => ({ category: value, videos: filtered.filter(video => video.category === value) })).filter(group => group.videos.length)
    : [{ category: '', videos: filtered }];
  const selected = videos.find(video => video.bvid === active);
  return <section className="official-videos" aria-label="官方角色影片">
    <div className="detail-section-intro">{character && <h3>官方影像</h3>}<span className="detail-small-meta">{normalizedQuery || category ? `${filtered.length} / ` : ''}{videos.length} 部</span></div>
    {!character && <label className="video-search search-field"><Search size={17} /><input aria-label="搜索角色影像" placeholder="搜索角色、影片名称" value={query} onChange={event => { setQuery(event.target.value); setActive(null); }} />{query && <button aria-label="清除影像搜索" onClick={() => setQuery('')}><X size={15} /></button>}</label>}
    {error ? <div className="video-empty"><p>{error}</p><button className="button button-outline" onClick={() => setRetry(value => value + 1)}><RotateCcw size={15} />重试</button></div>
      : !index ? <div className="detail-loading" role="status"><LoaderCircle className="spin" size={23} /><p>正在加载影片</p></div>
      : !videos.length ? <div className="video-empty"><Play size={28} strokeWidth={1.2} /><p>暂无已核实的角色专属影片</p><a href="https://space.bilibili.com/1955897084/upload/video" target="_blank" rel="noopener noreferrer">前往鸣潮官方投稿 <ExternalLink size={13} /></a></div>
      : <>
        {selected && <div className="official-player" ref={playerRef}>
          <div className="official-player-frame">{playerLoading && <span className="official-player-loading"><LoaderCircle className="spin" size={22} /></span>}<iframe key={selected.bvid} src={bilibiliPlayerUrl(selected.bvid)} title={selected.title} allow="fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setPlayerLoading(false)} /></div>
          <div className="official-player-caption"><strong>{selected.title}</strong><a href={selected.url} target="_blank" rel="noopener noreferrer">在B站观看<ExternalLink size={13} /></a></div>
        </div>}
        {categories.length > 1 && <div className="video-categories" aria-label="影片类型"><button aria-pressed={!category} className={!category ? 'active' : ''} onClick={() => { setCategory(''); setActive(null); }}>全部{!character && <span>{searched.length}</span>}</button>{categories.map(value => <button aria-pressed={category === value} className={category === value ? 'active' : ''} key={value} onClick={() => { setCategory(value); setActive(null); }}>{value}{!character && <span>{searched.filter(video => video.category === value).length}</span>}</button>)}</div>}
        {!filtered.length && <div className="video-empty"><Search size={25} /><p>没有符合条件的影片</p></div>}
        {groups.map(group => <section className="video-group" key={group.category || 'all'}>{group.category && <h3 className="video-group-heading">{group.category}<span>{group.videos.length} 部</span></h3>}<div className="official-video-list">{group.videos.map(video => <button key={video.bvid} className={`official-video-card ${active === video.bvid ? 'active' : ''}`} onClick={() => { if (active !== video.bvid) { setActive(video.bvid); setPlayerLoading(true); } }} aria-label={`观看${video.title}`}>
          <div className="official-video-cover">{video.cover && <img src={video.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />}<span className="video-play"><Play size={22} fill="currentColor" /></span>{video.duration && <span className="video-duration">{video.duration}</span>}</div>
          <div><span className="video-category">{video.category}{!character && ` · ${video.characterNames.join('、')}`}</span><h4>{video.title}</h4></div>
        </button>)}</div></section>)}
      </>}
  </section>;
}
