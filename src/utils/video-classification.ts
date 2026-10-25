import type { Character } from '../types';

export type VideoCategory = '角色宣传' | '战斗演示' | '先约电台' | '电台频道' | '共鸣者瞬间' | '共鸣者通讯' | '角色预告' | '服饰展示' | '角色短片' | '角色幕后';
export const VIDEO_CATEGORIES: VideoCategory[] = ['角色宣传', '角色预告', '共鸣者瞬间', '先约电台', '电台频道', '共鸣者通讯', '角色短片', '角色幕后', '服饰展示', '战斗演示'];
// The official video description explicitly names these two outfits and their owners.
const verifiedMappings: Record<string, string[]> = {
  '《鸣潮》服饰PV | 薄荷糖 & 蜜桃冰': ['琳奈', '千咲'],
};
export function charactersFromOfficialTags(tags: string[], characters: Pick<Character, 'name'>[]): string[] {
  const normalize = (value: string) => value.trim().replace(/^鸣潮/, '').replace(/[·\s]/g, '');
  const names = new Set(tags.map(normalize));
  return [...new Set(characters.filter(character => !character.name.startsWith('漂泊者-') && names.has(normalize(character.name))).map(character => character.name))];
}
export function classifyOfficialVideo(title: string, characters: Pick<Character, 'name' | 'outfits'>[]): { category: VideoCategory; characterNames: string[] } | null {
  const names = [...new Set(characters.map(c => c.name).filter(name => !name.startsWith('漂泊者-')))].sort((a, b) => b.length - a.length);
  let category: VideoCategory | null = /共鸣者[「“"]/.test(title) && /PV/i.test(title) ? '角色宣传'
    : /共鸣者战斗演示/.test(title) ? '战斗演示'
    : /先约电台.+频道/.test(title) ? '电台频道'
    : /先约电台/.test(title) && !/Remix|音乐特辑|即将上线/.test(title) ? '先约电台'
    : /^共鸣者瞬间/.test(title) ? '共鸣者瞬间'
    : /^共鸣者通讯/.test(title) ? '共鸣者通讯'
    : /寰宇人类注疏/.test(title) ? '角色预告'
    : /服饰PV/.test(title) ? '服饰展示'
    : /[「“"].+?[」”"].*PV幕后/.test(title) ? '角色幕后'
    : /仇远.*揭秘|“椿”坠异想奇境|维里奈的绿芽之约|^拍拍共鸣者|^寰宇频道|^共鸣者.*\||^.*全新共鸣者|^✦.*(?:的背包|登录认证)|^琳奈的极限|^和西格莉卡|^【互动视频】|^卡提希娅在|^客卿嘉贝莉娜/.test(title) ? '角色短片' : null;
  if (!category) return null;
  if (verifiedMappings[title]) return { category, characterNames: verifiedMappings[title] };
  let scope = category === '角色宣传' ? title.match(/共鸣者[「“"](.+?)[」”"]/)?.[1] || ''
    : category === '战斗演示' ? title.split(/[|丨｜]/).at(-1) || ''
    : category === '先约电台' ? title.split(/——/).at(-1)?.split('《')[0] || ''
    : ['电台频道', '共鸣者瞬间', '共鸣者通讯'].includes(category) ? title.split(/[|丨｜]/).at(-1) || ''
    : category === '角色预告' ? title.split(/——/).at(-1) || '' : title;
  const found: string[] = [];
  for (const name of names) {
    const matches = name.length > 1 ? scope.includes(name) : new RegExp(`(^|[\\s「」“”"'|丨｜：:·，。！!？?《》【】])${name}($|[\\s「」“”"'|丨｜：:·，。！!？?《》【】])`).test(scope);
    if (matches) { found.push(name); scope = scope.replaceAll(name, ''); }
  }
  if (category === '服饰展示') {
    for (const character of characters) if (character.outfits.some(outfit => title.includes(outfit.name))) found.push(character.name);
  }
  const characterNames = [...new Set(found)];
  return characterNames.length ? { category, characterNames } : null;
}
