import type { RosterEntry } from './display';
import { matchesSearch } from './display';

export interface RosterFilters { query: string; scope: string; element: string; weapon: string; gender: string; releaseVersion: string }
export function filterRoster(entries: RosterEntry[], filters: RosterFilters, ranked: Set<string>): RosterEntry[] {
  return entries.flatMap(entry => {
    if (!matchesSearch(entry, filters.query)) return [];
    if (filters.scope === 'ranked' && !ranked.has(entry.id)) return [];
    if (filters.scope === 'unranked' && ranked.has(entry.id)) return [];
    const locked = ranked.has(entry.id) && entry.variants.some(v => v.name === '秧秧');
    const candidates = locked ? [entry.character] : entry.variants;
    const matches = candidates.filter(v => (!filters.element || v.element === filters.element)
      && (!filters.weapon || v.weapon === filters.weapon) && (!filters.gender || v.gender === filters.gender)
      && (!filters.releaseVersion || v.releaseVersion === filters.releaseVersion));
    return matches.length ? [{ ...entry, character: matches.find(v => v.id === entry.character.id) || matches[0] }] : [];
  });
}
