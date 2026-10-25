import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { OfficialVideo } from '../components/OfficialVideos';

it('合并双账号的实际索引无重复，保留合作来源且所有关联都属于已收录角色', () => {
  const index = JSON.parse(readFileSync('public/data/videos.json', 'utf8'));
  const catalog = JSON.parse(readFileSync('public/data/index.json', 'utf8'));
  const names = new Set(catalog.characters.map((character: { name: string }) => character.name));
  const videos = index.videos as OfficialVideo[];
  expect(index.sources.map((source: { mid: string }) => source.mid)).toEqual(['1955897084', '3493090606188642']);
  const scanned = ['official', 'radio'].reduce((count, source) => count + JSON.parse(readFileSync(`research/${source}-bilibili-posts.json`, 'utf8')).posts.length, 0);
  expect(index.scannedCount).toBe(scanned);
  expect(new Set(videos.map(video => video.bvid)).size).toBe(videos.length);
  expect(new Set(videos.map(video => video.title.normalize('NFKC').replace(/[\s|丨｜]/g, '').toLowerCase())).size).toBe(videos.length);
  expect(videos.some(video => video.sources?.length === 2)).toBe(true);
  expect(videos.some(video => video.category === '电台频道' && video.characterNames.includes('锁暝'))).toBe(true);
  expect(videos.some(video => video.category === '角色幕后' && video.characterNames.includes('守岸人'))).toBe(true);
  for (const video of videos) {
    expect(video.bvid).toMatch(/^BV[A-Za-z0-9]{10}$/);
    expect(video.cover).toMatch(/^https:\/\/i[0-9]\.hdslb\.com\//);
    expect(video.characterNames.length).toBeGreaterThan(0);
    expect(video.characterNames.every(name => names.has(name))).toBe(true);
  }
});
