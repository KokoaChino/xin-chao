import { beforeAll, describe, expect, it, vi, afterEach } from 'vitest';
import { DOMParser } from 'linkedom';
import suomingSeed from '../../public/data/characters/1543075487722901504.json';
import type { Character } from '../types';
import {
  fetchWikiCatalog, originalMediaUrl, parseWikiCharacter, parseWikiResponse, toSummary,
  validateCharacterUpdate,
} from './wiki';

beforeAll(() => Object.assign(globalThis, { DOMParser }));
afterEach(() => vi.unstubAllGlobals());

const id = '1543075487722901504';
const image = 'https://prod-alicdn-community.kurobbs.com/forum/test.png';
const audio = 'https://web-static.kurobbs.com/wiki_audio/test.wav';
const item = { id, name: '测试角色' };
const baseRole = {
  type: 'role-component', title: '角色组件',
  role: {
    title: '测试角色', subtitle: 'TEST', roleDescription: '测试角色的介绍。',
    roleDescriptionTitle: '共鸣能力：十重契',
    info: [{ text: '性别：女' }, { text: '武器：迅刀' }, { text: '属性：导电' }],
    figures: [{ name: '编队立绘', url: image }],
  },
};

function detail(extraModules: unknown[] = []) {
  return {
    id,
    content: {
      modules: [{
        title: '基础资料',
        components: [
          baseRole,
          { type: 'basic-component', title: '其他信息', content: '<table><tr><td>身份</td><td>州监</td></tr><tr><td>英文CV</td><td>Example Actor</td></tr></table>' },
        ],
      }, ...extraModules],
    },
    lastEditUserName: 'not-for-product',
    userScoreList: [{ userId: 'not-for-product' }],
  };
}

describe('公开 Wiki 解析', () => {
  it('保留超过安全整数范围的原始 ID，并校验 HTTP 业务响应', () => {
    const response = parseWikiResponse('{"code":200,"success":true,"data":{"id":1543075487722901504}}');
    expect(response.id).toBe(id);
    expect(() => parseWikiResponse('{"code":220,"msg":"访问令牌不能为空"}')).toThrow('访问令牌不能为空');
    expect(() => parseWikiResponse('{"code":200,"data":null}')).toThrow('数据为空');
  });

  it('解析基础信息且仅输出产品字段，不复制编辑者和账号数据', () => {
    const character = parseWikiCharacter(detail(), item);
    expect(character.weapon).toBe('迅刀');
    expect(character.element).toBe('导电');
    expect(character.identity).toBe('州监');
    expect(character.resonanceName).toBe('十重契');
    expect(character.cv.英文).toBe('Example Actor');
    expect(JSON.stringify(character)).not.toContain('not-for-product');
    expect(toSummary(character)).not.toHaveProperty('voices');
  });

  it('拒绝损坏结构，避免用假空结果覆盖已有角色', () => {
    expect(() => parseWikiCharacter({ id, content: { modules: [] } }, item)).toThrow('结构已变化');
    expect(() => parseWikiCharacter({ id: '1249040336606580736', content: detail().content }, item)).toThrow('ID');
    expect(() => parseWikiCharacter(detail([{
      title: '角色档案',
      components: [{ type: 'tabs-component', title: '角色故事', content: '<p>仅活动标签</p>' }],
    }]), item)).toThrow('分栏内容结构已变化');
    expect(() => parseWikiCharacter(detail([{
      title: '角色语音',
      components: [{ type: 'audio-component', title: '个性语音', mediaTabs: [{ title: '中文' }] }],
    }]), item)).toThrow('语音列表缺失');
  });

  it('以栏目语义收集不同档案标题、嵌套故事分栏，保留正文和图片', () => {
    const character = parseWikiCharacter(detail([{
      title: '角色档案',
      components: [
        { type: 'basic-component', title: '共鸣能力鉴定报告6hz', content: '<p><strong>频谱检验报告</strong></p><p>档案正文。</p>' },
        { type: 'tabs-component', title: '角色故事', tabs: [{ title: '卷一', tabs: [
          { title: '归城', content: '<p>故事一。</p>' }, { title: '聚契', content: '<p>故事二。</p>' },
        ] }] },
        { type: 'tabs-component', title: '珍贵之物', tabs: [{ title: '特殊料理', content: `<p>华亭旧忆<img src="${image}"></p><p>提高队伍中所有共鸣者44%重击伤害加成，持续时间30分钟。</p><p>故事中的故乡风味。</p>` }] },
      ],
    }]), item);
    expect(character.archives[0].title).toBe('共鸣能力鉴定报告6hz');
    expect(character.archives[0].html).toContain('档案正文');
    expect(character.stories.map((story) => story.title)).toEqual(['归城', '聚契']);
    expect(character.treasures[0].images).toEqual([image]);
    expect(character.treasures[0].html).toContain('故乡风味');
    expect(character.treasures[0].html).not.toContain('44%');
  });

  it('合并皮肤说明和独立立绘，嵌套皮肤语音关联到对应皮肤', () => {
    const character = parseWikiCharacter(detail([{
      title: '额外服装',
      components: [
        { type: 'tabs-component', title: '角色皮肤', tabs: [{ title: '雨夜来信', content: `<p>服装说明。</p><img src="${image}">` }] },
        { type: 'tabs-component', title: '皮肤立绘', tabs: [{ title: '雨夜来信', tabs: [{ title: '海报', content: `<img src="${image}?v=2">` }] }] },
        { type: 'tabs-component', title: '服装语音', tabs: [{ title: '雨夜来信', components: [{
          type: 'audio-component', title: '专属语音',
          mediaTabs: [{ title: '中文：演员', mediaList: [{ id: '1', audioTitle: '换装', content: '喜欢吗？', playUrl: audio }] }],
        }] }] },
      ],
    }]), item);
    expect(character.outfits).toHaveLength(1);
    expect(character.outfits[0].name).toBe('雨夜来信');
    expect(character.outfits[0].descriptionHtml).toContain('服装说明');
    expect(character.outfits[0].images).toHaveLength(2);
    expect(character.outfits[0].voices).toHaveLength(1);
    expect(character.voices[0].outfitId).toBe(character.outfits[0].id);
  });

  it('遍历实际语种、保留同动作变体，将日语别名规范为日文', () => {
    const character = parseWikiCharacter(detail([{
      title: '角色语音',
      components: [{
        type: 'audio-component', title: '战斗语音',
        mediaTabs: [
          { title: '中文：演员', mediaList: [
            { id: '1', audioTitle: '普攻', content: '一式', playUrl: audio },
            { id: '2', audioTitle: '普攻', content: '二式', playUrl: `${audio}?v=2` },
          ] },
          { title: '日语：俳優', mediaList: [{ id: '3', audioTitle: 'Attack', content: '行くよ', playUrl: `${audio}?v=3` }] },
          { title: '法语：Acteur', mediaList: [{ id: '4', audioTitle: 'Attack', content: 'Allons-y', playUrl: `${audio}?v=4` }] },
          { title: '韩文：声优', content: '敬请期待', mediaList: [] },
        ],
      }],
    }]), item);
    expect(character.voices).toHaveLength(4);
    expect(character.voices.map((voice) => voice.language)).toEqual(['中文', '中文', '日文', '法语']);
    expect(character.voices.every((voice) => voice.category === 'combat')).toBe(true);
    expect(character.voices[2].text).toBe('行くよ');
    expect(character.syncWarnings).toContain('战斗语音 · 韩文：来源暂未提供音频');
  });

  it('保留原图并限制危险媒体协议，同时移除非内容 HTML', () => {
    expect(originalMediaUrl(`${image}?x-oss-process=image/resize,w_128,h_128`)).toBe(image);
    expect(originalMediaUrl('javascript:alert(1)')).toBe('');
    const character = parseWikiCharacter(detail([{
      title: '角色档案', components: [{ type: 'basic-component', title: '检验鉴定', content: '<p onclick="alert(1)">正文</p><script>alert(1)</script><img src="javascript:alert(1)">' }],
    }]), item);
    expect(character.archives[0].html).toBe('<p>正文</p>');
  });

  it('上游暂时漏项时保留旧内容，首次预告的空栏目仍可正常使用', () => {
    const oldCharacter = parseWikiCharacter(detail([{
      title: '角色档案', components: [{ type: 'tabs-component', title: '角色故事', tabs: [
        { title: '一', content: '<p>第一章</p>' }, { title: '二', content: '<p>第二章</p>' },
        { title: '三', content: '<p>第三章</p>' }, { title: '四', content: '<p>第四章</p>' },
      ] }],
    }]), item);
    const next = parseWikiCharacter(detail(), item);
    const checked = validateCharacterUpdate(oldCharacter, next);
    expect(checked.character.stories).toHaveLength(4);
    expect(checked.warnings).toContain('角色故事返回不完整，已保留上次成功资料');
    expect(next.stories).toHaveLength(0);
  });

  it('其他信息块和基础字段漏返时保留真实锁暝基准的身份、出生、版本及四语 CV', () => {
    const previous = suomingSeed as Character;
    const next = parseWikiCharacter({
      id,
      content: { modules: [{ title: '基础资料', components: [{
        ...baseRole,
        role: { ...baseRole.role, title: '锁暝', info: [] },
      }] }] },
    }, { id, name: '锁暝' });
    expect(next.identity).toBe('');
    expect(next.cv).toEqual({});
    const checked = validateCharacterUpdate(previous, next);
    for (const field of ['identity', 'origin', 'affiliation', 'specialty', 'weapon', 'element', 'releaseVersion'] as const) {
      expect(checked.character[field]).toBe(previous[field]);
      expect(checked.character[field]).not.toBe('');
    }
    expect(checked.character.cv).toEqual(previous.cv);
    expect(Object.keys(checked.character.cv)).toHaveLength(4);
    expect(checked.warnings).toContain('身份返回不完整，已保留上次成功资料');
    expect(checked.warnings).toContain('英文 CV返回不完整，已保留上次成功资料');
    expect(checked.character.syncWarnings).toContain('身份返回不完整，已保留上次成功资料');
    expect(next.cv).toEqual({});
  });

  it('按语种保护缺失 CV，同时接受非空的官方未知标记和正常演员更正', () => {
    const previous = { ...suomingSeed as Character, origin: '未知' };
    const next = {
      ...previous, origin: '', identity: '？？？', affiliation: '—',
      cv: { 中文: '更新后的演员', 日文: '待公布', 英文: ' ' },
    };
    const checked = validateCharacterUpdate(previous, next);
    expect(checked.character.origin).toBe('未知');
    expect(checked.character.identity).toBe('？？？');
    expect(checked.character.affiliation).toBe('—');
    expect(checked.character.cv.中文).toBe('更新后的演员');
    expect(checked.character.cv.日文).toBe('待公布');
    expect(checked.character.cv.英文).toBe(previous.cv.英文);
    expect(checked.character.cv.韩文).toBe(previous.cv.韩文);
    expect(checked.warnings.some((warning) => warning.startsWith('身份'))).toBe(false);
  });

  it('自动将未知新 ID 的男女漂泊者属性条目归入稳定身份，并复用对应头像', () => {
    for (const [name, identityId] of [
      ['漂泊者-女-冷凝', '1242294789908504576'],
      ['漂泊者-男-热熔', '1239724074505539584'],
    ]) {
      const newId = '1666666666666666666';
      const character = parseWikiCharacter({ ...detail(), id: newId }, { id: newId, name });
      expect(character.id).toBe(newId);
      expect(character.identityId).toBe(identityId);
      expect(character.avatar.width).toBe(500);
    }
  });

  it('不把名称相似的普通角色或不符合漂泊者命名规则的条目合并', () => {
    for (const name of ['小漂泊者-女-冷凝', '漂泊者-女-冷凝-异界', '漂泊者-女-', '秧秧·远行']) {
      const newId = '1666666666666666667';
      const character = parseWikiCharacter({ ...detail(), id: newId }, { id: newId, name });
      expect(character.identityId).toBe(newId);
    }
  });

  it('总语音数量增加时也保护意外消失的小语种', () => {
    const oldCharacter = parseWikiCharacter(detail([{
      title: '角色语音', components: [{
        type: 'audio-component', title: '个性语音', mediaTabs: [
          { title: '中文', mediaList: Array.from({ length: 5 }, (_, i) => ({
            id: String(i), audioTitle: `语音${i}`, content: '台词', playUrl: `${audio}?zh=${i}`,
          })) },
          { title: '法语', mediaList: [{ id: '8', audioTitle: '问候', content: 'Bonjour', playUrl: `${audio}?fr=1` }] },
        ],
      }],
    }]), item);
    const next = { ...oldCharacter, voices: [
      ...oldCharacter.voices.filter((voice) => voice.language === '中文'),
      ...oldCharacter.voices.filter((voice) => voice.language === '中文').map((voice) => ({ ...voice, id: `${voice.id}-extra`, url: `${voice.url}&extra=1` })),
    ] };
    const checked = validateCharacterUpdate(oldCharacter, next);
    expect(checked.character.voices).toHaveLength(11);
    expect(checked.character.voiceCount).toBe(11);
    expect(checked.character.voices.at(-1)?.language).toBe('法语');
  });

  it('动态发现目录并无损读取长整数，不依赖固定列表或登录凭据', async () => {
    const responses = [
      '{"code":200,"data":{"name":"全部","children":[{"name":"游戏图鉴","children":[{"id":1105,"name":"共鸣者"},{"id":1363,"name":"头像"}]}]}}',
      `{"code":200,"data":{"results":{"total":1,"pages":1,"records":[{"entryId":${id},"name":"测试角色","content":{"contentUrl":"${image}"}}]}}}`,
      `{"code":200,"data":{"results":{"total":1,"pages":1,"records":[{"entryId":1553551844728930304,"name":"测试角色","content":{"contentUrl":"${image}?avatar=1"}}]}}}`,
    ];
    const fetchMock = vi.fn().mockImplementation(async () => new Response(responses.shift(), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchWikiCatalog();
    expect(result).toEqual([{ id, name: '测试角色', iconUrl: `${image}?avatar=1`, wikiBadge: '' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([, init]) => init.credentials === 'omit' && !init.headers.Authorization)).toBe(true);
  });
});
