import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { CharacterSummary } from '../types';
import { characterName, imageUrl } from '../utils/display';

interface Props {
  title: string;
  character?: CharacterSummary;
  position?: number;
  count?: number;
  onPrevious?: () => void;
  onNext?: () => void;
  onOpen?: () => void;
}

export default function Spotlight({ title, character, position = 0, count = 0, onPrevious, onNext, onOpen }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [character?.id]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      ref.current?.style.setProperty('--mx', `${(x - .5) * 18}px`);
      ref.current?.style.setProperty('--my', `${(y - .5) * 12}px`);
      ref.current?.style.setProperty('--rx', `${(.5 - y) * 3}deg`);
      ref.current?.style.setProperty('--ry', `${(x - .5) * 3}deg`);
      ref.current?.style.setProperty('--shine-x', `${x * 100}%`);
      ref.current?.style.setProperty('--shine-y', `${y * 100}%`);
    });
  };
  const leave = () => {
    cancelAnimationFrame(frame.current);
    for (const key of ['--mx', '--my', '--rx', '--ry']) ref.current?.style.setProperty(key, '0');
    ref.current?.style.setProperty('--shine-x', '50%');
    ref.current?.style.setProperty('--shine-y', '40%');
  };
  return <div className="spotlight" ref={ref} onPointerMove={move} onPointerLeave={leave}>
    <div className="spotlight-surface"><span className="spotlight-orbit" /><span className="spotlight-glow" />
      <h1 className="glass-title">{/XP排行榜$/i.test(title)
        ? <>{title.slice(0, -5)}<span className="spotlight-title-end">{title.slice(-5)}</span></>
        : title}</h1>
      {character && <div className="spotlight-character" key={character.id}>
        <span className="spotlight-english" aria-hidden="true">{character.romanizedName}</span>
        {character.hero && !failed && <button className="spotlight-image" onClick={onOpen} aria-label={`查看${characterName(character)}的档案`}><img src={imageUrl(character.hero.url, 1000)} alt={characterName(character)} onError={() => setFailed(true)} /><span className="spotlight-foil" aria-hidden="true" style={{ "--foil-mask": `url("${imageUrl(character.hero.url, 1000)}")` } as CSSProperties} /></button>}
        <div className="spotlight-caption"><button onClick={onOpen}>{characterName(character)}</button>{character.romanizedName && <span className="spotlight-roman-mobile">{character.romanizedName}</span>}{character.resonanceName && <p>{character.resonanceName}</p>}</div>
      </div>}
      {onPrevious && onNext && count > 1 && <div className="spotlight-switch"><button aria-label="上一位共鸣者" onClick={onPrevious}><ChevronLeft size={18} /></button><span>{String(position + 1).padStart(2, '0')} / {count}</span><button aria-label="下一位共鸣者" onClick={onNext}><ChevronRight size={18} /></button></div>}
    </div>
  </div>;
}
