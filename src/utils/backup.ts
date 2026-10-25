import type { Preferences } from '../types';
import type { RosterEntry } from './display';
import { characterName } from './display';
import { createDefaultPreferences, MAX_PREFERENCES_BYTES } from '../data/preferences';

export function rankingTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed || ['我的偏爱序列', '我的偏爱', '我的XP排行榜'].includes(trimmed)) return '我的共鸣者XP排行榜';
  return /XP排行榜$/i.test(trimmed) ? trimmed : `${trimmed}XP排行榜`;
}

function canonicalName(entry: RosterEntry): string {
  return characterName(entry.variants.find(variant => variant.id === entry.id) || entry.variants[0]);
}

export function exportRanking(preferences: Preferences, entries: RosterEntry[]): string {
  const roster = new Map(entries.map(entry => [entry.id, entry]));
  const characters = preferences.order.map(id => {
    const entry = roster.get(id);
    if (!entry) throw new Error('有角色资料尚未加载，暂时无法按名称导出。');
    return { name: canonicalName(entry), form: entry.character.name };
  });
  return JSON.stringify({ version: 2, title: rankingTitle(preferences.title), characters }, null, 2);
}

export function importRanking(input: string, entries: RosterEntry[]): Preferences {
  if (new TextEncoder().encode(input).byteLength > MAX_PREFERENCES_BYTES) throw new Error('文件不能超过 1 MB。');
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error('请选择有效的 JSON 文件。'); }
  const object = (data: unknown): data is Record<string, unknown> => Boolean(data) && typeof data === 'object' && !Array.isArray(data)
    && !Object.keys(data as object).some(key => ['__proto__', 'constructor', 'prototype'].includes(key));
  if (!object(value) || value.version !== 2 || typeof value.title !== 'string' || value.title.length > 60
    || !Array.isArray(value.characters) || value.characters.length > 2000) throw new Error('榜单格式不正确，需要角色名称列表。');
  const preferences = createDefaultPreferences();
  preferences.title = rankingTitle(value.title);
  if (preferences.title.length > 60) throw new Error('榜单标题不能超过 60 个字符。');
  preferences.selectedVariants = {};
  const byName = new Map(entries.map(entry => [canonicalName(entry), entry]));
  const unknown: string[] = [];
  for (const item of value.characters) {
    if (!object(item) || typeof item.name !== 'string' || item.name.length > 100
      || (item.form !== undefined && (typeof item.form !== 'string' || item.form.length > 100))) throw new Error('每一项都需要有效的角色名称。');
    const entry = byName.get(item.name);
    if (!entry) { unknown.push(item.name); continue; }
    if (preferences.order.includes(entry.id)) throw new Error(`角色重复：${item.name}。每位角色只能占用一个名额。`);
    const variant = item.form ? entry.variants.find(variant => variant.name === item.form)
      : entry.variants.find(variant => variant.id === entry.id) || entry.variants[0];
    if (!variant) throw new Error(`${item.name}没有“${item.form}”这一形态。`);
    preferences.order.push(entry.id);
    preferences.selectedVariants[entry.id] = variant.id;
  }
  if (unknown.length) throw new Error(`未找到角色：${unknown.slice(0, 5).join('、')}。请检查名称或等待资料加载完成。`);
  return preferences;
}
