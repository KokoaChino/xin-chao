import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { RosterEntry } from '../utils/display';
import { characterName, elementColor, imageUrl } from '../utils/display';
import { RANKING_FIELDS } from '../utils/poster';
import CharacterImage from './CharacterImage';

interface Props {
  entries: RosterEntry[]; ready: boolean;
  onOpen: (entry: RosterEntry) => void; onReorder: (ids: string[]) => void; onRemove: (id: string) => void;
}
function RankItem({ entry, index, total, ready, onOpen, onRemove, onMove }: {
  entry: RosterEntry; index: number; total: number; ready: boolean;
  onOpen: () => void; onRemove: () => void; onMove: (direction: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id, disabled: !ready, attributes: { role: 'group', roleDescription: '可排序的排名卡片' } });
  const c = entry.character;
  return <article ref={setNodeRef} {...attributes} {...listeners} aria-label={`${characterName(c)}，第${index + 1}名，可拖动排序`} onKeyDown={event => { if (event.target === event.currentTarget) listeners?.onKeyDown?.(event); }} onDragStart={event => event.preventDefault()} data-rank-id={entry.id} style={{ transform: CSS.Transform.toString(transform), transition, '--character-color': elementColor(c.element), zIndex: isDragging ? 20 : undefined } as CSSProperties} className={`rank-item ${isDragging ? 'is-dragging' : ''}`}>
    <div className="rank-backdrop" aria-hidden="true">{c.poster && <img src={imageUrl(c.poster.url, 1080)} alt="" loading="lazy" referrerPolicy="no-referrer" />}<span>{c.romanizedName}</span></div>
    <span className="rank-position">{String(index + 1).padStart(2, '0')}</span>
    <button className="rank-image-button" onClick={onOpen} aria-label={`查看第${index + 1}名${characterName(c)}`}><CharacterImage src={c.hero?.url || c.poster?.url} name={characterName(c)} size={900} className="rank-art" /></button>
    <div className="rank-item-info"><span className="rank-roman">{c.romanizedName}</span><button className="rank-name" onClick={onOpen}><h3>{characterName(c)}</h3></button><dl className="rank-facts">{RANKING_FIELDS.map(field => <div key={field.key} className={field.key === 'resonanceName' ? 'rank-resonance' : ''}><dt>{field.label}</dt><dd>{c[field.key] || '—'}</dd></div>)}</dl></div>
    <div className="rank-edit-controls" onMouseDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()}><button disabled={!ready || index === 0} onClick={() => onMove(-1)} aria-label={`将${characterName(c)}上移一名`}><ArrowUp size={15} /></button><button disabled={!ready || index === total - 1} onClick={() => onMove(1)} aria-label={`将${characterName(c)}下移一名`}><ArrowDown size={15} /></button><button disabled={!ready} className="rank-remove" onClick={onRemove} aria-label={`将${characterName(c)}移出榜单`}><X size={15} /></button></div>
  </article>;
}
export default function RankBoard({ entries, ready, onOpen, onReorder, onRemove }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { top: number; left: number }>());
  const animateNext = useRef(false);
  const order = entries.map(e => e.id).join(',');
  useLayoutEffect(() => {
    const next = new Map<string, { top: number; left: number }>();
    container.current?.querySelectorAll<HTMLElement>('[data-rank-id]').forEach(node => {
      const id = node.dataset.rankId!;
      const current = { top: node.offsetTop, left: node.offsetLeft };
      const old = positions.current.get(id);
      if (animateNext.current && old && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const dx = old.left - current.left, dy = old.top - current.top;
        if (dx || dy) node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 380, easing: 'cubic-bezier(.22,.8,.3,1)' });
      }
      next.set(id, current);
    });
    positions.current = next; animateNext.current = false;
  }, [order]);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 7 } }), useSensor(TouchSensor, { activationConstraint: { delay: 240, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const move = (id: string, direction: number) => {
    const index = entries.findIndex(entry => entry.id === id), next = index + direction;
    if (index >= 0 && next >= 0 && next < entries.length) {
      positions.current = new Map([...container.current!.querySelectorAll<HTMLElement>('[data-rank-id]')]
        .map(node => [node.dataset.rankId!, { top: node.offsetTop, left: node.offsetLeft }]));
      animateNext.current = true;
      onReorder(arrayMove(entries.map(entry => entry.id), index, next));
    }
  };
  if (!entries.length) return <div className="ranking-empty"><span>00</span><h2>暂无排名</h2></div>;
  return <section aria-label="我的共鸣者XP排行榜"><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
    if (!over || active.id === over.id || !ready) return;
    const ids = entries.map(entry => entry.id), from = ids.indexOf(String(active.id)), to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to));
  }} accessibility={{ screenReaderInstructions: { draggable: '聚焦排名卡片后，按空格拾起，方向键移动，再按空格确认，Escape取消。' } }}>
    <SortableContext items={entries.map(entry => entry.id)} strategy={verticalListSortingStrategy}><div ref={container} className="ranking-list">{entries.map((entry, index) => <RankItem key={entry.id} entry={entry} index={index} total={entries.length} ready={ready} onOpen={() => onOpen(entry)} onRemove={() => onRemove(entry.id)} onMove={direction => move(entry.id, direction)} />)}</div></SortableContext>
  </DndContext></section>;
}
