import { useMemo, useState, type CSSProperties } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import type { RosterEntry } from '../utils/display';
import { characterName, elementColor } from '../utils/display';
import { filterRoster } from '../utils/roster';
import CharacterImage from './CharacterImage';
import SelectField from './SelectField';

interface Props {
  entries: RosterEntry[]; ranked: string[]; ready: boolean;
  onOpen: (entry: RosterEntry) => void; onToggleRank: (entry: RosterEntry) => void;
  onVariant: (identityId: string, variantId: string) => void;
}
export default function CatalogGrid({ entries, ranked, ready, onOpen, onToggleRank, onVariant }: Props) {
  const [query, setQuery] = useState(''); const [scope, setScope] = useState('');
  const [element, setElement] = useState(''); const [gender, setGender] = useState('');
  const [weapon, setWeapon] = useState(''); const [releaseVersion, setReleaseVersion] = useState('');
  const rankedSet = useMemo(() => new Set(ranked), [ranked]);
  const options = useMemo(() => {
    const variants = entries.flatMap(entry => entry.variants);
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
    return { elements: unique(variants.map(v => v.element)), weapons: unique(variants.map(v => v.weapon)),
      versions: unique(variants.map(v => v.releaseVersion)).sort((a, b) => b.localeCompare(a, 'zh-CN', { numeric: true })) };
  }, [entries]);
  const filtered = useMemo(() => filterRoster(entries, { query, scope, element, gender, weapon, releaseVersion }, rankedSet), [entries, query, scope, element, gender, weapon, releaseVersion, rankedSet]);
  const reset = () => { setQuery(''); setScope(''); setElement(''); setGender(''); setWeapon(''); setReleaseVersion(''); };
  return <section className="catalog-section" aria-label="全部共鸣者">
    <div className="catalog-filters">
      <div className="search-filter"><span>搜索</span><label className="search-field"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="角色名称 / 英文名" aria-label="搜索角色名字或英文名" />{query && <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button>}</label></div>
      <SelectField label="性别" value={gender} onChange={setGender}><option value="">全部性别</option><option>女</option><option>男</option></SelectField>
      <SelectField label="属性" value={element} onChange={setElement}><option value="">全部属性</option>{options.elements.map(v => <option key={v}>{v}</option>)}</SelectField>
      <SelectField label="武器" value={weapon} onChange={setWeapon}><option value="">全部武器</option>{options.weapons.map(v => <option key={v}>{v}</option>)}</SelectField>
      <SelectField label="榜单" value={scope} onChange={setScope}><option value="">全部角色</option><option value="ranked">已加入</option><option value="unranked">未加入</option></SelectField>
      <SelectField label="实装版本" value={releaseVersion} onChange={setReleaseVersion}><option value="">全部版本</option>{options.versions.map(v => <option key={v}>{v}</option>)}</SelectField>
      <button className="filter-reset" onClick={reset}>重置</button>
    </div>
    <div className="catalog-meta">共 {filtered.length} 位</div>
    {filtered.length ? <div className="character-grid">{filtered.map((entry, index) => {
      const c = entry.character; const inRank = rankedSet.has(entry.id);
      const locked = inRank && entry.variants.some(v => v.name === '秧秧');
      return <article className={`character-card ${inRank ? 'in-rank' : ''}`} key={entry.id} style={{ '--character-color': elementColor(c.element), '--i': Math.min(index, 12) } as CSSProperties}>
        <button className="character-open" onClick={() => onOpen(entry)} aria-label={`查看${characterName(c)}的档案`}><div className="character-portrait"><span className="portrait-orbit" /><CharacterImage src={c.avatar.url} fallback={c.avatar.fallbackUrl || c.hero?.url} name={characterName(c)} size={360} />{c.wikiBadge && <span className="character-corner">{c.wikiBadge}</span>}</div><div className="character-info"><span className="character-roman">{c.romanizedName}</span><h3>{characterName(c)}</h3>{c.affiliation && <p>{c.affiliation}</p>}</div></button>
        {entry.variants.length > 1 && <div className="card-variant"><SelectField value={c.id} disabled={!ready || locked} ariaLabel={`切换${characterName(c)}形态`} onChange={value => onVariant(entry.id, value)}>{entry.variants.map(v => <option key={v.id} value={v.id}>{v.name.startsWith('漂泊者-') ? v.element : v.name}</option>)}</SelectField></div>}
        <button className={`rank-add ${inRank ? 'added' : ''}`} disabled={!ready} onClick={() => onToggleRank(entry)} aria-label={inRank ? `将${characterName(c)}移出榜单` : `将${characterName(c)}加入榜单`}>{inRank ? <Check size={14} /> : <Plus size={14} />}{inRank ? '已加入榜单' : '加入榜单'}</button>
      </article>;
    })}</div> : <div className="catalog-empty"><Search size={25} /><h3>没有符合条件的共鸣者</h3><button className="button button-outline" onClick={reset}>重置筛选</button></div>}
  </section>;
}
