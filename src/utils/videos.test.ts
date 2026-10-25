import { describe, expect, it } from 'vitest';
import { charactersFromOfficialTags, classifyOfficialVideo } from './video-classification';
import { bilibiliPlayerUrl, matchingVideos, type OfficialVideo } from '../components/OfficialVideos';
import { wikiBadgeFromContent } from '../data/wiki';

const characters = [
  { name: '心', outfits: [] }, { name: '秧秧', outfits: [] }, { name: '秧秧·玄翎', outfits: [] },
  { name: '今汐', outfits: [{ id: 'skin', name: '桃夭灼灼', descriptionHtml: '', images: [], voices: [] }] },
  { name: '长离', outfits: [{ id: 'skin2', name: '桂枝宁芙', descriptionHtml: '', images: [], voices: [] }] },
];
describe('官方视频关联', () => {
  it('优先使用标题明确指向的形态，短名称不误匹配，版本和剧情标题不强行归属', () => {
    expect(classifyOfficialVideo('《鸣潮》共鸣者「秧秧·玄翎」PV | 噩梦', characters)).toEqual({
      category: '角色宣传', characterNames: ['秧秧·玄翎'],
    });
    expect(classifyOfficialVideo('《鸣潮》共鸣者战斗演示 | 心', characters)).toEqual({ category: '战斗演示', characterNames: ['心'] });
    expect(classifyOfficialVideo('《鸣潮》先约电台EP3.7——心《心月辞》', characters)).toEqual({ category: '先约电台', characterNames: ['心'] });
    expect(classifyOfficialVideo('《鸣潮》3.7版本PV | 镜锁妄世，心照红尘', characters)).toBeNull();
    expect(classifyOfficialVideo('《鸣潮》剧情动画 | 心声·心生', characters)).toBeNull();
    expect(classifyOfficialVideo('《鸣潮》先约电台EP1.1「往岁乘霄」', characters)).toBeNull();
  });
  it('服饰名称关联到正确角色；多角色共同服饰视频保留全部关联', () => {
    expect(classifyOfficialVideo('《鸣潮》服饰PV | 桃夭灼灼 & 桂枝宁芙', characters)).toEqual({
      category: '服饰展示', characterNames: ['今汐', '长离'],
    });
  });
  it('补收电台频道、瞬间和通讯，精确区分心和形态，不把无名标题猜成角色', () => {
    expect(classifyOfficialVideo('先约电台深夜频道 | 心', characters)).toEqual({ category: '电台频道', characterNames: ['心'] });
    expect(classifyOfficialVideo('先约电台晚餐频道 | 秧秧·玄翎', characters)).toEqual({ category: '电台频道', characterNames: ['秧秧·玄翎'] });
    expect(classifyOfficialVideo('共鸣者瞬间 | 秧秧·玄翎', characters)).toEqual({ category: '共鸣者瞬间', characterNames: ['秧秧·玄翎'] });
    expect(classifyOfficialVideo('共鸣者通讯 | 今汐', characters)).toEqual({ category: '共鸣者通讯', characterNames: ['今汐'] });
    expect(classifyOfficialVideo('拍拍共鸣者 | 长离的制胜之法', characters)).toEqual({ category: '角色短片', characterNames: ['长离'] });
    expect(classifyOfficialVideo('寰宇频道特别栏目 | 人类情感表达测试', characters)).toBeNull();
    expect(classifyOfficialVideo('拍拍共鸣者 | 出门在外，小心饮食', characters)).toBeNull();
    expect(classifyOfficialVideo('《鸣潮》「长离」展示PV幕后特别影像——「某短片」', characters)).toEqual({ category: '角色幕后', characterNames: ['长离'] });
  });
  it('播放器只接受完整BV号，默认不自动播放，形态之间不混入影片', () => {
    const video = { bvid: 'BV1Nb421n7Kh', title: 'test', characterNames: ['今汐'] } as OfficialVideo;
    expect(bilibiliPlayerUrl(video.bvid)).toContain('autoplay=0');
    expect(() => bilibiliPlayerUrl('bad&id=evil')).toThrow('无效');
    expect(matchingVideos([video], { id: '1', identityId: '1', name: '今汐' })).toEqual([video]);
    expect(matchingVideos([video], { id: '2', identityId: '2', name: '长离' })).toEqual([]);
  });
  it('官方角色标签严格匹配，支持中点差异，但泛用和版本标签不产生关联', () => {
    expect(charactersFromOfficialTags(['鸣潮', '鸣潮陆赫斯', '鸣潮心'], [...characters, { name: '陆·赫斯', outfits: [] }])).toEqual(['心', '陆·赫斯']);
    expect(charactersFromOfficialTags(['鸣潮1.4版本', '心照红尘', '鸣潮秧秧·玄翎'], characters)).toEqual(['秧秧·玄翎']);
  });
});
describe('官方角标', () => {
  const now = Date.parse('2026-10-24T12:00:00+08:00');
  it('依官方枚举和中国时区有效范围显示，不以实装版本和属性猜标签', () => {
    const content = { showTeaserIcon: true, showTeaserIconNum: 1, teaserDateRange: ['2026-10-20 00:00:00', '2026-10-30 23:59:59'] };
    expect(wikiBadgeFromContent(content, now)).toBe('新');
    expect(wikiBadgeFromContent({ ...content, showTeaserIconNum: 2 }, now)).toBe('预告');
    expect(wikiBadgeFromContent({ ...content, showTeaserIconNum: 3 }, now)).toBe('复刻');
    expect(wikiBadgeFromContent({ ...content, showTeaserIcon: false }, now)).toBe('');
    expect(wikiBadgeFromContent(content, Date.parse('2026-11-01T00:00:00+08:00'))).toBe('');
  });
});
