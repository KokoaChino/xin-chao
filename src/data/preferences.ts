import type { Preferences, Tier } from '../types';

export const MAX_PREFERENCES_BYTES = 1024 * 1024;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_TITLE_LENGTH = 60;
export const MAX_SUBTITLE_LENGTH = 180;
const MAX_CHARACTERS = 2000;
const INVALID_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const TIERS = new Set<Tier>(['s', 'a', 'b', 'c']);

export function createDefaultPreferences(now = new Date().toISOString()): Preferences {
  return {
    schemaVersion: 1,
    title: '我的共鸣者XP排行榜',
    subtitle: '',
    order: [],
    notes: {},
    tiers: {},
    favorites: [],
    updatedAt: now,
  };
}

export function isSafeIdentityId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
    && !INVALID_KEYS.has(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}格式不正确。`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label}必须是普通数据对象。`);
  }
  if (Object.keys(value).some((key) => INVALID_KEYS.has(key))) {
    throw new Error(`${label}包含不安全的字段。`);
  }
}

function readText(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`${label}必须是长度不超过 ${max} 字的文字。`);
  }
  return value;
}

function readIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_CHARACTERS) {
    throw new Error(`${label}格式不正确，最多支持 ${MAX_CHARACTERS} 个角色。`);
  }
  if (!value.every(isSafeIdentityId) || new Set(value).size !== value.length) {
    throw new Error(`${label}包含重复或无效的角色标识。`);
  }
  return [...value];
}

export function validatePreferences(input: unknown): Preferences {
  let value: unknown = input;
  if (typeof value === 'string') {
    if (new TextEncoder().encode(value).byteLength > MAX_PREFERENCES_BYTES) {
      throw new Error('备份文件过大，请选择小于 1 MB 的排行榜备份。');
    }
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new Error('无法解析备份文件，请选择有效的 JSON 文件。');
    }
  }
  assertRecord(value, '备份');
  if (value.schemaVersion !== 1) throw new Error('不支持此备份版本，请使用本页面导出的排行榜备份。');
  const title = readText(value.title, MAX_TITLE_LENGTH, '榜单标题');
  const subtitle = readText(value.subtitle, MAX_SUBTITLE_LENGTH, '榜单副标题');
  const order = readIds(value.order, '排名');
  const favorites = readIds(value.favorites, '收藏');
  assertRecord(value.notes, '偏爱理由');
  assertRecord(value.tiers, '偏爱分级');
  if (Object.keys(value.notes).length > MAX_CHARACTERS || Object.keys(value.tiers).length > MAX_CHARACTERS) {
    throw new Error('备份包含的角色数量过多。');
  }
  const notes: Record<string, string> = {};
  const tiers: Record<string, Tier> = {};
  for (const [id, text] of Object.entries(value.notes)) {
    if (!isSafeIdentityId(id)) throw new Error('偏爱理由包含无效的角色标识。');
    notes[id] = readText(text, MAX_NOTE_LENGTH, '偏爱理由');
  }
  for (const [id, tier] of Object.entries(value.tiers)) {
    if (!isSafeIdentityId(id) || typeof tier !== 'string' || !TIERS.has(tier as Tier)) {
      throw new Error('偏爱分级包含无效的角色或等级。');
    }
    tiers[id] = tier as Tier;
  }
  const updatedAt = readText(value.updatedAt, 64, '更新时间');
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('备份中的更新时间无效。');
  const preferences: Preferences = {
    schemaVersion: 1, title, subtitle, order, notes, tiers, favorites, updatedAt,
  };
  if (value.selectedVariants !== undefined) {
    assertRecord(value.selectedVariants, '角色形态');
    if (Object.keys(value.selectedVariants).length > MAX_CHARACTERS) throw new Error('角色形态数量过多。');
    const selectedVariants: Record<string, string> = {};
    for (const [id, variant] of Object.entries(value.selectedVariants)) {
      if (!isSafeIdentityId(id) || !isSafeIdentityId(variant)) throw new Error('角色形态包含无效标识。');
      selectedVariants[id] = variant;
    }
    preferences.selectedVariants = selectedVariants;
  }
  if (new TextEncoder().encode(JSON.stringify(preferences)).byteLength > MAX_PREFERENCES_BYTES) {
    throw new Error('备份数据过大，无法导入。');
  }
  return preferences;
}

export function exportPreferences(preferences: Preferences): string {
  return JSON.stringify(validatePreferences(preferences), null, 2);
}
