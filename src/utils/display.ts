import type { CharacterSummary } from '../types';

export const ELEMENTS = ['衍射', '湮灭', '导电', '热熔', '冷凝', '气动'];

export interface RosterEntry {
  id: string;
  character: CharacterSummary;
  variants: CharacterSummary[];
}

export function groupRoster(characters: CharacterSummary[], selectedVariants: Record<string, string> = {}): RosterEntry[] {
  const groups = new Map<string, RosterEntry>();
  for (const character of characters) {
    const id = character.identityId || character.id;
    const group = groups.get(id);
    if (!group) groups.set(id, { id, character, variants: [character] });
    else {
      group.variants.push(character);
      if (character.id === id) group.character = character;
    }
  }
  return [...groups.values()].map(group => ({
    ...group,
    character: group.variants.find(variant => variant.id === selectedVariants[group.id]) || group.character,
  }));
}

export function imageUrl(url: string | undefined | null, width = 480): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'prod-alicdn-community.kurobbs.com') {
      parsed.searchParams.set('x-oss-process', `image/resize,w_${Math.round(width)}`);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

export function elementColor(element: string): string {
  return ({
    衍射: '#ae9254', 湮灭: '#8d6686', 导电: '#826cac',
    热熔: '#c67557', 冷凝: '#6791ac', 气动: '#699283',
  } as Record<string, string>)[element] || '#849184';
}

export function formatDate(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '基础档案';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

export function characterName(character: CharacterSummary): string {
  if (character.name.startsWith('漂泊者-女')) return '漂泊者 · 女';
  if (character.name.startsWith('漂泊者-男')) return '漂泊者 · 男';
  return character.displayName || character.name;
}

export function matchesSearch(entry: RosterEntry, query: string): boolean {
  const normalized = query.toLocaleLowerCase().replace(/[\s·\-]/g, '');
  if (!normalized) return true;
  return entry.variants.some((character) =>
    [character.name, character.displayName, character.romanizedName, character.affiliation]
      .join(' ').toLocaleLowerCase().replace(/[\s·\-]/g, '').includes(normalized),
  );
}
