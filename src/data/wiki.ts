import JSONBig from 'json-bigint';
import { uniqueVoices } from '../utils/voices';
import overridesJson from './asset-overrides.json';
import type {
  Artwork, Avatar, Character, CharacterSummary, LoreEntry, Outfit, Voice, WikiCatalogItem,
} from '../types';

type Raw = Record<string, unknown>;
type Context = { node: Raw; path: string[] };
type Overrides = {
  roverIdentityIds: Record<string, string>;
  identityGroups: Record<string, string>;
  characters: Record<string, { name: string; avatar: Avatar }>;
  artworkDimensions: Record<string, { width: number; height: number }>;
};

const overrides = overridesJson as Overrides;
const losslessJson = JSONBig({ storeAsString: true, strict: true });
const API_ROOT = 'https://api.kurobbs.com/wiki/core';
const wikiAvatars = new Map<string, string>();
const allowedTags = new Set([
  'P', 'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SPAN', 'DIV',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI',
  'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'IMG', 'A', 'DETAILS', 'SUMMARY',
]);

function raw(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function documentFromHtml(value: unknown): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>${string(value)}</body></html>`, 'text/html',
  );
}

function text(value: unknown): string {
  return (documentFromHtml(value).body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function originalMediaUrl(value: unknown): string {
  if (!string(value).trim()) return '';
  try {
    const url = new URL(string(value), 'https://wiki.kurobbs.com');
    if (url.protocol !== 'https:') return '';
    if (/\.kurobbs\.com$/.test(url.hostname)) url.searchParams.delete('x-oss-process');
    return url.href;
  } catch {
    return '';
  }
}

function mediaUrl(value: unknown): string {
  if (!string(value).trim()) return '';
  return originalMediaUrl(value);
}

function normalizedHtml(value: unknown, omitFoodEffects = false): string {
  const doc = documentFromHtml(value);
  doc.querySelectorAll('script,style,iframe,object,embed,form,input,button,svg,canvas').forEach((el) => el.remove());
  if (omitFoodEffects) {
    doc.querySelectorAll('p').forEach((el) => {
      const content = el.textContent ?? '';
      if (/(?:持续时间|多人游戏中|复苏指定共鸣者)/.test(content)
        && /(?:提高|提升|恢复|降低|增加|减少|复苏)/.test(content)) el.remove();
    });
  }
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (!allowedTags.has(el.tagName)) {
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    const src = el.tagName === 'IMG' ? mediaUrl(el.getAttribute('src')) : '';
    const href = el.tagName === 'A' ? mediaUrl(el.getAttribute('href')) : '';
    const span = el.getAttribute('colspan');
    const row = el.getAttribute('rowspan');
    const alt = el.getAttribute('alt');
    for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
    if (el.tagName === 'IMG') {
      if (!src) { el.remove(); continue; }
      el.setAttribute('src', src);
      el.setAttribute('loading', 'lazy');
      if (alt && !alt.startsWith('blob:')) el.setAttribute('alt', alt);
    }
    if (href) {
      el.setAttribute('href', href);
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
    if (span && /^\d{1,2}$/.test(span)) el.setAttribute('colspan', span);
    if (row && /^\d{1,2}$/.test(row)) el.setAttribute('rowspan', row);
  }
  return doc.body.innerHTML.trim();
}

function htmlImages(html: string): string[] {
  return [...new Set(Array.from(documentFromHtml(html).querySelectorAll('img'))
    .map((img) => mediaUrl(img.getAttribute('src'))).filter(Boolean))];
}

function hasContent(html: unknown): boolean {
  return Boolean(text(html) || htmlImages(string(html)).length);
}

function artwork(url: unknown, label: string, kind: Artwork['kind'], orientation?: Artwork['orientation']): Artwork | null {
  const original = mediaUrl(url);
  if (!original) return null;
  return { url: original, label, kind, ...(orientation ? { orientation } : {}), ...overrides.artworkDimensions[original] };
}

function uniqueArt(images: Artwork[]): Artwork[] {
  return images.filter((image, i) => images.findIndex((other) =>
    other.url === image.url && other.kind === image.kind && other.orientation === image.orientation) === i);
}

function componentContexts(content: Raw): Context[] {
  const results: Context[] = [];
  function visit(value: unknown, path: string[]) {
    const node = raw(value);
    const title = text(node.title);
    const nextPath = title ? [...path, title] : path;
    if (string(node.type).endsWith('-component')) results.push({ node, path: nextPath });
    for (const key of ['modules', 'components', 'tabs']) {
      for (const child of array(node[key])) visit(child, nextPath);
    }
    if (node.content && typeof node.content === 'object') visit(node.content, nextPath);
  }
  visit(content, []);
  return results;
}

function sectionLeaves(node: Raw, parentTitles: string[] = []): { title: string; html: string; node: Raw; titles: string[] }[] {
  const titles = [...parentTitles, text(node.title)].filter(Boolean);
  if (node.type === 'tabs-component' && !Array.isArray(node.tabs)) {
    throw new Error(`分栏内容结构已变化：${text(node.title)}`);
  }
  const tabs = array(node.tabs).map(raw);
  if (tabs.length) return tabs.flatMap((tab) => sectionLeaves(tab, titles));
  const components = array(node.components).map(raw);
  if (components.length) return components.flatMap((component) => sectionLeaves(component, titles));
  return hasContent(node.content) ? [{ title: text(node.title), html: string(node.content), node, titles }] : [];
}

function loreEntries(node: Raw, prefix: string, omitFoodEffects = false): LoreEntry[] {
  return sectionLeaves(node).map((entry, i) => {
    const html = normalizedHtml(entry.html, omitFoodEffects && /特殊料理|料理/.test(entry.title));
    return {
      id: `${prefix}-${i}`,
      title: entry.title || text(node.title) || '未命名章节',
      html,
      images: htmlImages(html),
    };
  });
}

function languageInfo(title: string): { language: string; cv: string } {
  const [languageLabel, ...rest] = title.split(/[:：]/);
  const aliases: Record<string, string> = {
    中文: '中文', 汉语: '中文', 国语: '中文', 日语: '日文', 日文: '日文',
    英语: '英文', 英文: '英文', 韩语: '韩文', 韩文: '韩文',
  };
  const clean = languageLabel.trim().replace(/\s*[（(].*$/, '');
  return { language: aliases[clean] || clean || '未标注语种', cv: rest.join('：').trim() };
}

function voiceEntries(node: Raw, category: Voice['category'], prefix: string, warnings: string[], outfitId?: string): Voice[] {
  const tabs = array(node.mediaTabs);
  if (!Array.isArray(node.mediaTabs)) throw new Error(`语音结构已变化：${text(node.title) || prefix}`);
  const result: Voice[] = [];
  for (const [tabIndex, tabValue] of tabs.entries()) {
    const tab = raw(tabValue);
    const info = languageInfo(text(tab.title));
    if (!Array.isArray(tab.mediaList)) throw new Error(`语音列表缺失：${text(node.title)} / ${info.language}`);
    const tracks = array(tab.mediaList);
    if (!tracks.length) warnings.push(`${text(node.title)} · ${info.language}：来源暂未提供音频`);
    for (const [voiceIndex, value] of tracks.entries()) {
      const entry = raw(value);
      const url = mediaUrl(entry.playUrl);
      if (!url) {
        warnings.push(`${text(node.title)} · ${text(entry.audioTitle) || voiceIndex + 1}：音频链接缺失`);
        continue;
      }
      result.push({
        id: `${prefix}-${tabIndex}-${string(entry.id) || voiceIndex}`,
        title: text(entry.audioTitle) || `语音 ${voiceIndex + 1}`,
        text: text(entry.content),
        url,
        language: info.language,
        cv: info.cv,
        category,
        ...(outfitId ? { outfitId } : {}),
      });
      if (!text(entry.content)) warnings.push(`${text(node.title)} · ${text(entry.audioTitle) || voiceIndex + 1}：来源暂未提供台词`);
    }
    if (tracks.length && !result.some((voice) => voice.id.startsWith(`${prefix}-${tabIndex}-`))) {
      throw new Error(`语音条目存在但无法解析音频链接：${text(node.title)} / ${info.language}`);
    }
  }
  return result;
}

function dataFromEnvelope(value: unknown): Raw {
  const envelope = raw(value);
  if (String(envelope.code) !== '200' || envelope.success === false) {
    throw new Error(`Wiki 请求失败：${text(envelope.msg) || String(envelope.code)}`);
  }
  if (!envelope.data || typeof envelope.data !== 'object') throw new Error('Wiki 返回的数据为空');
  return raw(envelope.data);
}

export function parseWikiResponse(body: string): Raw {
  return dataFromEnvelope(losslessJson.parse(body));
}

async function request(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<Raw> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new DOMException('Wiki 请求超时', 'TimeoutError')), 25_000);
  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', wiki_type: '9', source: 'wiki' },
      body: new URLSearchParams(params),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Wiki HTTP ${response.status}`);
    return parseWikiResponse(await response.text());
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function catalogueId(tree: Raw, name: string): string {
  function visit(node: Raw, inAtlas: boolean): string {
    const isAtlas = inAtlas || text(node.name) === '游戏图鉴';
    if (isAtlas && text(node.name) === name) return string(node.id);
    for (const child of array(node.children)) {
      const found = visit(raw(child), isAtlas);
      if (found) return found;
    }
    return '';
  }
  const id = visit(tree, false);
  if (!id) throw new Error(`Wiki 目录结构已变化：未找到“游戏图鉴 / ${name}”`);
  return id;
}

async function catalogueRecords(id: string, signal?: AbortSignal): Promise<Raw[]> {
  const records: Raw[] = [];
  let expectedTotal = -1;
  for (let page = 1; page <= 30; page += 1) {
    const data = await request('/catalogue/item/getPage', { catalogueId: id, page: String(page), limit: '1000' }, signal);
    const result = raw(data.results);
    if (!Array.isArray(result.records)) throw new Error('Wiki 目录列表结构已变化');
    const total = Number(result.total);
    const pages = Number(result.pages);
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(pages) || pages < 0) {
      throw new Error('Wiki 分页信息无效');
    }
    if (page === 1) expectedTotal = total;
    if (total !== expectedTotal) throw new Error('Wiki 目录更新中，请稍后重试');
    records.push(...array(result.records).map(raw));
    if (page >= pages) break;
    if (!array(result.records).length || page === 30) throw new Error('Wiki 分页不完整');
  }
  const ids = records.map((record) => string(record.entryId));
  if (records.length !== expectedTotal || new Set(ids).size !== ids.length || ids.some((idValue) => !/^\d+$/.test(idValue))) {
    throw new Error('Wiki 目录数量或条目 ID 校验失败');
  }
  return records;
}

export function wikiBadgeFromContent(value: unknown, now = Date.now()): string {
  const content = raw(value);
  if (content.showTeaserIcon !== true) return '';
  const dates = array(content.teaserDateRange).map(string);
  const localTime = (date: string) => Date.parse(`${date.replace(' ', 'T')}+08:00`);
  if (dates[0] && now < localTime(dates[0])) return '';
  if (dates[1] && now > localTime(dates[1])) return '';
  return ({ '1': '新', '2': '预告', '3': '复刻' } as Record<string, string>)[string(content.showTeaserIconNum)] || '';
}

export async function fetchWikiCatalog(signal?: AbortSignal): Promise<WikiCatalogItem[]> {
  const tree = await request('/catalogue/config/getTree', {}, signal);
  const characterId = catalogueId(tree, '共鸣者');
  const records = await catalogueRecords(characterId, signal);
  if (!records.length) throw new Error('Wiki 共鸣者目录为空，已保留已有资料');
  // Avatar updates are supplemental; a failed avatar request must not block character discovery.
  try {
    const avatars = await catalogueRecords(catalogueId(tree, '头像'), signal);
    for (const avatar of avatars) {
      const url = mediaUrl(raw(avatar.content).contentUrl);
      if (url) wikiAvatars.set(text(avatar.name), url);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return records.map((record) => {
    const name = text(record.name);
    if (!name) throw new Error('Wiki 目录出现无名称角色');
    const avatarName = /^漂泊者-([男女])-/.exec(name)?.[1];
    return {
      id: string(record.entryId),
      name,
      wikiBadge: wikiBadgeFromContent(record.content),
      iconUrl: wikiAvatars.get(name) || (avatarName ? wikiAvatars.get(`${avatarName}漂泊者`) : undefined)
        || mediaUrl(raw(record.content).contentUrl) || undefined,
    };
  });
}

export function parseWikiCharacter(detail: Raw, item: WikiCatalogItem, fetchedAt = new Date().toISOString()): Character {
  if (string(detail.id) && string(detail.id) !== item.id) throw new Error('Wiki 详情 ID 与目录不一致');
  const content = typeof detail.content === 'string' ? raw(losslessJson.parse(detail.content)) : raw(detail.content);
  if (!Array.isArray(content.modules) || !content.modules.length) throw new Error(`${item.name}：Wiki 详情结构已变化`);
  const contexts = componentContexts(content);
  const roleNode = contexts.find(({ node }) => node.type === 'role-component')?.node;
  const role = raw(roleNode?.role);
  if (!text(role.title) || !Array.isArray(role.figures) || !text(role.roleDescription)) {
    throw new Error(`${item.name}：基础资料不完整，已保留已有资料`);
  }
  const info: Record<string, string> = {};
  for (const value of array(role.info)) {
    const label = text(raw(value).text);
    const parts = label.split(/[:：]/);
    if (parts.length > 1) info[parts.shift()!.trim()] = parts.join('：').trim();
  }
  for (const { node } of contexts) {
    if (!/^(其他信息|基础信息|基本信息)$/.test(text(node.title))) continue;
    for (const entry of sectionLeaves(node)) {
      const doc = documentFromHtml(entry.html);
      for (const tr of Array.from(doc.querySelectorAll('tr'))) {
        const cells = Array.from(tr.children).filter((el) => ['TD', 'TH'].includes(el.tagName));
        if (cells.length >= 2) info[text(cells[0].innerHTML)] = text(cells[1].innerHTML);
      }
    }
  }
  const artworks: Artwork[] = [];
  for (const value of array(role.figures)) {
    const figure = raw(value);
    const label = text(figure.name) || '角色立绘';
    const kind: Artwork['kind'] = /编队/.test(label) ? 'team' : /海报/.test(label) ? 'poster'
      : /皮肤|服装|服饰/.test(label) ? 'skin' : /立绘|基本|基础|预告/.test(label) ? 'portrait' : 'other';
    const main = artwork(figure.url, label, kind, 'desktop');
    const mobile = artwork(figure.verticalFigureUrl, `${label} · 移动版`, kind, 'mobile');
    if (main) artworks.push(main);
    if (mobile) artworks.push(mobile);
  }
  if (!artworks.length) throw new Error(`${item.name}：角色图片结构已变化`);

  const warnings: string[] = [];
  const archives: LoreEntry[] = [];
  const treasures: LoreEntry[] = [];
  const stories: LoreEntry[] = [];
  const voices: Voice[] = [];
  const outfitsByName = new Map<string, Outfit>();
  const claimedLore = new Set<Raw>();
  const ensureOutfit = (name: string): Outfit => {
    const existing = outfitsByName.get(name);
    if (existing) return existing;
    const outfit: Outfit = { id: `${item.id}-outfit-${encodeURIComponent(name)}`, name, descriptionHtml: '', images: [], voices: [] };
    outfitsByName.set(name, outfit);
    return outfit;
  };

  for (const { node, path } of contexts) {
    const title = text(node.title);
    if (!/皮肤|服装|服饰/.test(path.join('/')) || node.type === 'audio-component') continue;
    for (const entry of sectionLeaves(node)) {
      const generic = /^(角色皮肤|皮肤立绘|服饰|服装|编队立绘|海报立绘|立绘|海报|简介|介绍|说明)$/;
      const name = entry.titles.slice(1).find((candidate) => !generic.test(candidate))
        || path.slice(1).find((candidate) => !generic.test(candidate)) || title;
      const outfit = ensureOutfit(name);
      const html = normalizedHtml(entry.html);
      const isArtSection = /立绘|海报/.test([title, entry.title].join('/'));
      if (text(html) && !isArtSection && !outfit.descriptionHtml.includes(html)) {
        outfit.descriptionHtml += html;
      }
      for (const [index, url] of htmlImages(html).entries()) {
        const kind: Artwork['kind'] = /编队/.test(title) ? 'team' : /海报/.test(title) ? 'poster' : 'skin';
        const image = artwork(url, `${name} · ${isArtSection ? title : `展示 ${index + 1}`}`, kind);
        if (image) outfit.images.push(image);
      }
    }
  }

  for (const [index, { node, path }] of contexts.entries()) {
    const title = text(node.title);
    const fullPath = path.join('/');
    if (node.type === 'audio-component') {
      const outfitName = [...outfitsByName.keys()].find((name) => fullPath.includes(name));
      const outfit = outfitName ? outfitsByName.get(outfitName) : undefined;
      const category: Voice['category'] = outfit || /皮肤|服装|服饰/.test(fullPath) ? 'outfit'
        : /战斗/.test(fullPath) ? 'combat' : 'personality';
      const entries = voiceEntries(node, category, `${item.id}-voice-${index}`, warnings, outfit?.id);
      voices.push(...entries);
      if (outfit) outfit.voices.push(...entries);
      continue;
    }
    if (claimedLore.has(node) || /皮肤|服装|服饰/.test(fullPath)) continue;
    const target = /珍贵之物/.test(title) ? treasures : /角色故事|人物故事/.test(title) ? stories
      : /档案|检验|鉴定|诊断/.test(fullPath) && !/珍贵之物|故事|语音/.test(fullPath) ? archives : null;
    if (!target) continue;
    const entries = loreEntries(node, `${item.id}-lore-${index}`, target === treasures);
    if (!entries.length && hasContent(node.content)) throw new Error(`${item.name}：${title}解析失败`);
    target.push(...entries);
    for (const child of componentContexts(node)) claimedLore.add(child.node);
  }

  const isPreview = artworks.every((image) => image.kind !== 'team') && artworks.some((image) => /预告/.test(image.label));
  if (!archives.length) warnings.push('来源暂未提供角色档案');
  if (!treasures.length) warnings.push('来源暂未提供珍贵之物');
  if (!stories.length) warnings.push('来源暂未提供角色故事');
  if (!voices.length) warnings.push('来源暂未提供可播放语音');
  const hero = artworks.find((image) => image.kind === 'team' && image.orientation === 'desktop')
    || artworks.find((image) => image.kind === 'portrait') || artworks[0] || null;
  const poster = artworks.find((image) => image.kind === 'poster' && image.orientation === 'desktop') || null;
  const roverGender = /^漂泊者-([男女])-[^-\s]+$/.exec(item.name)?.[1];
  const identityId = overrides.identityGroups[item.id]
    || (roverGender ? overrides.roverIdentityIds[roverGender] : '') || item.id;
  const preferredAvatar = overrides.characters[item.id]?.avatar || overrides.characters[identityId]?.avatar;
  const portrait = artworks.find((image) => image.kind === 'portrait') || hero;
  const liveWikiAvatar = wikiAvatars.get(item.name);
  const avatar = preferredAvatar
    ? { ...preferredAvatar, fallbackUrl: preferredAvatar.fallbackUrl || item.iconUrl || portrait?.url }
    : { url: liveWikiAvatar || portrait?.url || item.iconUrl || '', fallbackUrl: portrait?.url };
  const cv = Object.fromEntries(Object.entries(info)
    .filter(([key]) => /CV$/i.test(key)).map(([key, value]) => [languageInfo(key.replace(/CV$/i, '')).language, value]));
  const outfits = [...outfitsByName.values()].map((outfit) => ({
    ...outfit, images: uniqueArt(outfit.images), voices: uniqueVoices(outfit.voices),
  }));
  const distinctVoices = uniqueVoices(voices);
  for (const outfit of outfits) {
    if (!outfit.images.length && !outfit.descriptionHtml) throw new Error(`${item.name}：皮肤 ${outfit.name} 内容为空`);
  }
  for (const [label, value] of Object.entries({
    出生地: info.出生 || info.出生地,
    身份: info.身份,
    所属: info.所属,
    实装版本: info.实装版本,
  })) if (!value) warnings.push(`${label}：来源暂未提供`);
  return {
    id: item.id,
    identityId,
    name: item.name,
    displayName: /^漂泊者-([男女])-/.test(item.name) ? `漂泊者 · ${info.性别 || item.name.split('-')[1]}` : text(role.title),
    romanizedName: text(role.subtitle),
    description: text(role.roleDescription),
    resonanceName: text(role.roleDescriptionTitle).replace(/^共鸣能力\s*[:：]\s*/, ''),
    gender: info.性别 || '',
    origin: info.出生 || info.出生地 || '',
    identity: info.身份 || '',
    affiliation: info.所属 || '',
    specialty: info.特殊料理 || '',
    weapon: info.武器 || '',
    element: info.属性 || '',
    releaseVersion: info.实装版本 || '',
    cv,
    avatar,
    hero,
    poster,
    artworks: uniqueArt(artworks),
    archives,
    treasures,
    stories,
    outfits,
    voices: distinctVoices,
    hasOutfits: outfits.length > 0,
    voiceCount: distinctVoices.length,
    isPreview,
    wikiBadge: item.wikiBadge || '',
    sourceUrl: `https://wiki.kurobbs.com/mc/item/${item.id}`,
    fetchedAt,
    syncWarnings: [...new Set(warnings)],
  };
}

export function validateCharacterUpdate(previous: Character, next: Character): { character: Character; warnings: string[] } {
  if (previous.id !== next.id) throw new Error('不能合并不同角色的资料');
  const character: Character = { ...next };
  const warnings: string[] = [];
  const basicLabels = {
    name: '角色名称', displayName: '展示名称', romanizedName: '外文名称',
    description: '角色简介', resonanceName: '共鸣能力', gender: '性别',
    origin: '出生地', identity: '身份', affiliation: '所属', specialty: '特殊料理',
    weapon: '武器', element: '属性', releaseVersion: '实装版本',
  } as const;
  for (const field of Object.keys(basicLabels) as (keyof typeof basicLabels)[]) {
    if (previous[field].trim() && !next[field].trim()) {
      character[field] = previous[field];
      warnings.push(`${basicLabels[field]}返回不完整，已保留上次成功资料`);
    }
  }
  character.cv = { ...next.cv };
  for (const [language, actor] of Object.entries(previous.cv)) {
    if (actor.trim() && !next.cv[language]?.trim()) {
      character.cv[language] = actor;
      warnings.push(`${language} CV返回不完整，已保留上次成功资料`);
    }
  }
  const suspiciousDrop = (before: number, after: number) =>
    before > 0 && (after === 0 || (before >= 2 && after < Math.ceil(before * 0.75)));
  const labels = { archives: '角色档案', treasures: '珍贵之物', stories: '角色故事', voices: '角色语音', artworks: '角色立绘' };
  for (const field of ['archives', 'treasures', 'stories', 'voices', 'artworks'] as const) {
    const oldItems = previous[field];
    const newItems = next[field];
    let incomplete = suspiciousDrop(oldItems.length, newItems.length);
    if (['archives', 'treasures', 'stories'].includes(field)) {
      const oldLength = (oldItems as LoreEntry[]).reduce((sum, item) => sum + text(item.html).length, 0);
      const newLength = (newItems as LoreEntry[]).reduce((sum, item) => sum + text(item.html).length, 0);
      incomplete ||= oldLength > 200 && newLength < oldLength * 0.5;
    }
    if (incomplete) {
      Object.assign(character, { [field]: oldItems });
      warnings.push(`${labels[field]}返回不完整，已保留上次成功资料`);
    }
  }
  const restoreVoiceGroups = (oldTracks: Voice[], newTracks: Voice[], label: string): Voice[] => {
    const oldVoices = uniqueVoices(oldTracks);
    const newVoices = uniqueVoices(newTracks);
    const keyFor = (voice: Voice) => `${voice.language}/${voice.category}/${voice.outfitId || ''}`;
    let restored = newVoices;
    for (const key of new Set(oldVoices.map(keyFor))) {
      const before = oldVoices.filter((voice) => keyFor(voice) === key);
      const after = newVoices.filter((voice) => keyFor(voice) === key);
      if (suspiciousDrop(before.length, after.length)) {
        restored = [...restored.filter((voice) => keyFor(voice) !== key), ...before];
        warnings.push(`${label} · ${before[0].language}返回不完整，已保留上次成功音轨`);
      }
    }
    return restored;
  };
  character.voices = restoreVoiceGroups(previous.voices, character.voices, '角色语音');
  const outfits = next.outfits.map((outfit) => ({ ...outfit }));
  for (const oldOutfit of previous.outfits) {
    const current = outfits.find((outfit) => outfit.id === oldOutfit.id || outfit.name === oldOutfit.name);
    if (!current) {
      outfits.push(oldOutfit);
      warnings.push(`皮肤“${oldOutfit.name}”暂未返回，已保留上次成功资料`);
      continue;
    }
    for (const field of ['images', 'voices'] as const) {
      if (suspiciousDrop(oldOutfit[field].length, current[field].length)) {
        Object.assign(current, { [field]: oldOutfit[field] });
        warnings.push(`皮肤“${oldOutfit.name}”${field === 'images' ? '图片' : '语音'}返回不完整，已保留上次成功资料`);
      }
    }
    if (oldOutfit.descriptionHtml && !text(current.descriptionHtml)) {
      current.descriptionHtml = oldOutfit.descriptionHtml;
      warnings.push(`皮肤“${oldOutfit.name}”说明暂未返回，已保留上次成功资料`);
    }
    current.voices = restoreVoiceGroups(oldOutfit.voices, current.voices, `皮肤“${oldOutfit.name}”`);
  }
  character.outfits = outfits;
  character.hasOutfits = outfits.length > 0;
  character.voices = uniqueVoices(character.voices);
  character.voiceCount = character.voices.length;
  if (character.artworks === previous.artworks) {
    character.hero = previous.hero;
    character.poster = previous.poster;
  }
  character.syncWarnings = [...new Set([...next.syncWarnings, ...warnings])];
  return { character, warnings };
}

export async function fetchWikiCharacter(item: WikiCatalogItem, signal?: AbortSignal): Promise<Character> {
  const detail = await request('/catalogue/item/getEntryDetail', { id: item.id }, signal);
  return parseWikiCharacter(detail, item);
}

export function toSummary(character: Character): CharacterSummary {
  const {
    id, identityId, name, displayName, romanizedName, description, resonanceName, gender, origin,
    affiliation, weapon, element, releaseVersion, avatar, hero, poster, hasOutfits,
    voiceCount, isPreview, wikiBadge, sourceUrl, fetchedAt,
  } = character;
  return {
    id, identityId, name, displayName, romanizedName, description, resonanceName, gender, origin,
    affiliation, weapon, element, releaseVersion, avatar, hero, poster, hasOutfits,
    voiceCount, isPreview, wikiBadge, sourceUrl, fetchedAt,
  };
}
