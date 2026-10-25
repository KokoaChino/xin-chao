import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, CircleAlert, LoaderCircle, Pause, Play, Search, Volume2, VolumeX, X } from 'lucide-react';
import type { Voice } from '../types';
import { uniqueVoices } from '../utils/voices';

interface VoicePlayerProps {
  voices: Voice[];
  compact?: boolean;
}

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文', 'zh-CN': '中文', 'zh-Hans': '中文', cn: '中文',
  ja: '日文', 'ja-JP': '日文', jp: '日文',
  en: '英文', 'en-US': '英文',
  ko: '韩文', 'ko-KR': '韩文', kr: '韩文',
};

const CATEGORY_LABELS: Record<Voice['category'], string> = {
  personality: '个性语音', combat: '战斗语音', outfit: '服装语音',
};

function formatTime(time: number) {
  if (!Number.isFinite(time)) return '0:00';
  const seconds = Math.max(0, Math.floor(time));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function VoicePlayer({ voices, compact = false }: VoicePlayerProps) {
  const playableVoices = useMemo(() => uniqueVoices(voices), [voices]);
  const languages = useMemo(() => [...new Set(playableVoices.map((voice) => voice.language))], [playableVoices]);
  const languageOptions = [...new Set(['中文', '日文', '英文', '韩文', ...languages])];
  const categories = useMemo(
    () => (['personality', 'combat', 'outfit'] as const).filter((category) => playableVoices.some((voice) => voice.category === category)),
    [playableVoices],
  );
  const [language, setLanguage] = useState(languages[0] ?? '');
  const [category, setCategory] = useState<Voice['category']>(categories[0] ?? 'personality');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [audioError, setAudioError] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const requestRef = useRef(0);
  const activeSourceRef = useRef<Pick<Voice, 'id' | 'url' | 'language' | 'category'> | null>(null);
  const activeVoice = playableVoices.find((voice) => voice.id === activeId);
  const selectedLanguage = languages.includes(language) ? language : (languages[0] ?? '');
  const selectedCategory = categories.includes(category) ? category : (categories[0] ?? 'personality');
  const visibleCategories = categories.filter((item) => playableVoices.some((voice) => voice.language === selectedLanguage && voice.category === item));
  const effectiveCategory = visibleCategories.includes(selectedCategory) ? selectedCategory : (visibleCategories[0] ?? selectedCategory);
  const filteredVoices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return playableVoices.filter((voice) => (
      voice.language === selectedLanguage &&
      voice.category === effectiveCategory &&
      (!needle || `${voice.title} ${voice.text}`.toLocaleLowerCase().includes(needle))
    ));
  }, [playableVoices, selectedLanguage, effectiveCategory, query]);

  useEffect(() => {
    const audio = audioRef.current;
    requestRef.current += 1;
    audio?.pause();
    if (audio) {
      audio.removeAttribute('src');
      audio.load();
    }
    activeSourceRef.current = null;
    setActiveId(null);
    setStatus('idle');
    setAudioError('');
    setCurrentTime(0);
    setDuration(0);
    return () => {
      requestRef.current += 1;
      audio?.pause();
      if (audio) {
        audio.removeAttribute('src');
        audio.load();
      }
    };
  }, [selectedLanguage, effectiveCategory, query]);

  useEffect(() => {
    const source = activeSourceRef.current;
    if (!source) return;
    const replacement = playableVoices.find((voice) => voice.id === source.id);
    if (
      !replacement ||
      replacement.url !== source.url ||
      replacement.language !== source.language ||
      replacement.category !== source.category
    ) stopPlayback();
  }, [playableVoices]);

  async function toggleVoice(voice: Voice) {
    const audio = audioRef.current;
    if (!audio) return;
    if (activeId === voice.id && (status === 'playing' || status === 'loading')) {
      requestRef.current += 1;
      audio.pause();
      setStatus('paused');
      return;
    }

    const request = ++requestRef.current;
    setAudioError('');
    if (activeId !== voice.id || status === 'error') {
      audio.pause();
      audio.src = voice.url;
      audio.load();
      activeSourceRef.current = { id: voice.id, url: voice.url, language: voice.language, category: voice.category };
      setActiveId(voice.id);
      setDuration(0);
      setCurrentTime(0);
    }
    audio.playbackRate = speed;
    audio.muted = muted;
    setStatus('loading');
    try {
      await audio.play();
      if (request === requestRef.current) setStatus('playing');
    } catch (error) {
      if (request !== requestRef.current) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus('error');
      setAudioError('这段语音暂时无法加载，请重试或查看来源页面。');
    }
  }

  function stopPlayback() {
    requestRef.current += 1;
    const audio = audioRef.current;
    audio?.pause();
    if (audio) {
      audio.removeAttribute('src');
      audio.load();
    }
    activeSourceRef.current = null;
    setActiveId(null);
    setStatus('idle');
    setAudioError('');
    setCurrentTime(0);
    setDuration(0);
  }

  if (!playableVoices.length) {
    return (
      <div className="detail-empty">
        <AudioLines size={30} strokeWidth={1.3} />
        <h3>等待新的声音</h3>
        <p>当前来源尚未提供可播放的音频。资料更新后，会在这里继续收录。</p>
      </div>
    );
  }

  return (
    <section className={`detail-voices${compact ? ' detail-voices--compact' : ''}`} aria-label="角色语音">
      <audio
        ref={audioRef}
        preload="none"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => setStatus('paused')}
        onWaiting={() => setStatus((current) => current === 'playing' ? 'loading' : current)}
        onPlaying={() => setStatus('playing')}
        onError={(event) => {
          if (!event.currentTarget.getAttribute('src')) return;
          setStatus('error');
          setAudioError('这段语音暂时无法加载，请重试或查看来源页面。');
        }}
      />
      <div className="detail-section-intro">
        <div>
          
          <h3>角色语音</h3>
        </div>
        <span className="detail-small-meta">{playableVoices.length} 段 · {languages.length} 种语言</span>
      </div>
      <div className="detail-language-list" aria-label="语音语言">
        {languageOptions.map((item) => (
          <button
            type="button"
            key={item}
            className={selectedLanguage === item ? 'is-selected' : ''}
            aria-pressed={selectedLanguage === item}
            disabled={!languages.includes(item)}
            title={!languages.includes(item) ? '当前 Wiki 暂无该语种音轨' : undefined}
            onClick={() => setLanguage(item)}
          >
            {LANGUAGE_LABELS[item] || item || '未标注语言'}{!languages.includes(item) && <small>敬请期待</small>}
          </button>
        ))}
      </div>
      <div className="detail-voice-tools">
        <div className="detail-voice-categories" aria-label="语音类型">
          {visibleCategories.map((item) => (
            <button
              type="button"
              key={item}
              className={effectiveCategory === item ? 'is-selected' : ''}
              aria-pressed={effectiveCategory === item}
              onClick={() => setCategory(item)}
            >
              {CATEGORY_LABELS[item]}
            </button>
          ))}
        </div>
        <label className="detail-voice-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索语音标题或台词"
            placeholder="搜索台词"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {activeVoice && (
        <div className="detail-audio-console" aria-label="当前播放">
          <div className="detail-audio-topline">
            <button
              type="button"
              className="detail-audio-main-button"
              onClick={() => void toggleVoice(activeVoice)}
              aria-label={status === 'playing' || status === 'loading' ? '暂停语音' : '播放语音'}
            >
              {status === 'loading' ? <LoaderCircle className="detail-spin" size={18} /> : status === 'playing' ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <div className="detail-audio-now">
              <span>{activeVoice.title}</span>
              <small>{activeVoice.cv ? `配音：${activeVoice.cv}` : LANGUAGE_LABELS[activeVoice.language] || activeVoice.language}</small>
            </div>
            <label className="detail-audio-speed">
              <span className="detail-sr-only">播放速度</span>
              <select value={speed} onChange={(event) => {
                const value = Number(event.target.value);
                setSpeed(value);
                if (audioRef.current) audioRef.current.playbackRate = value;
              }}>
                <option value={0.75}>0.75×</option>
                <option value={1}>1×</option>
                <option value={1.25}>1.25×</option>
                <option value={1.5}>1.5×</option>
              </select>
            </label>
            <button type="button" className="detail-icon-button" aria-label={muted ? '取消静音' : '静音'} onClick={() => {
              setMuted(!muted);
              if (audioRef.current) audioRef.current.muted = !muted;
            }}>
              {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <button type="button" className="detail-icon-button" aria-label="停止播放" onClick={stopPlayback}><X size={17} /></button>
          </div>
          <div className="detail-audio-progress">
            <span>{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={Number.isFinite(duration) && duration > 0 ? duration : 1}
              step={0.1}
              value={Math.min(currentTime, duration || 1)}
              disabled={!Number.isFinite(duration) || duration <= 0}
              aria-label="语音播放进度"
              aria-valuetext={`${formatTime(currentTime)}，共 ${formatTime(duration)}`}
              onChange={(event) => {
                const time = Number(event.target.value);
                if (audioRef.current) audioRef.current.currentTime = time;
                setCurrentTime(time);
              }}
            />
            <span>{formatTime(duration)}</span>
          </div>
          {audioError && <p className="detail-audio-error" role="status"><CircleAlert size={14} />{audioError}</p>}
        </div>
      )}
      <div className="detail-voice-results" aria-live="polite">
        <span>{filteredVoices.length} 段{query ? '匹配语音' : '语音'}</span>
        {filteredVoices[0]?.cv && <span>配音：{filteredVoices[0].cv}</span>}
      </div>
      <div className="detail-voice-list">
        {filteredVoices.map((voice, index) => {
          const active = activeId === voice.id;
          const isPlaying = active && (status === 'playing' || status === 'loading');
          return (
            <article key={voice.id} className={`detail-voice-row${active ? ' is-active' : ''}`}>
              <button
                type="button"
                className="detail-voice-play"
                aria-label={`${isPlaying ? '暂停' : '播放'}：${voice.title}`}
                onClick={() => void toggleVoice(voice)}
              >
                {active && status === 'loading'
                  ? <LoaderCircle size={17} className="detail-spin" />
                  : isPlaying ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <div className="detail-voice-copy">
                <div className="detail-voice-title"><h4>{voice.title}</h4><span>{String(index + 1).padStart(2, '0')}</span></div>
                <p>{voice.text || '来源未提供对应台词。'}</p>
              </div>
            </article>
          );
        })}
      </div>
      {!filteredVoices.length && <p className="detail-inline-empty">没有找到这句台词，试试其他关键词。</p>}

    </section>
  );
}
