import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { Character } from '../src/types';
import { charactersFromOfficialTags, classifyOfficialVideo } from '../src/utils/video-classification';

const sources = await Promise.all(['official', 'radio'].map(async name => JSON.parse(await readFile(`research/${name}-bilibili-posts.json`, 'utf8'))));
const evidence: { videos: { bvid: string; title: string; tags: string[] }[] } = JSON.parse(await readFile('research/video-role-evidence.json', 'utf8'));
const tagEvidence = new Map(evidence.videos.map(video => [video.bvid, video]));
const index = JSON.parse(await readFile('public/data/index.json', 'utf8'));
const characters: Character[] = await Promise.all(index.characters.map(async (item: { id: string }) => JSON.parse(await readFile(`public/data/characters/${item.id}.json`, 'utf8'))));
interface Post { title: string; url: string; cover: string; duration?: string; date: string }
const posts = sources.flatMap(source => source.posts.map((post: Post) => ({
  bvid: post.url.match(/BV[A-Za-z0-9]{10}/)?.[0] || '', title: post.title,
  cover: post.cover ? `https:${post.cover}`.replace(/^https:https:/, 'https:').split('@')[0] : '',
  duration: '', publishedLabel: post.date?.trim() || '',
  sources: [{ mid: source.ownerMid || '1955897084', name: source.ownerName || '鸣潮' }],
})));
type VideoPost = typeof posts[number];
const unique = new Map<string, VideoPost>();
const titleKeys = new Map<string, string>();
for (const post of posts) {
  if (!post.bvid) throw new Error(`无效BV号：${post.title}`);
  const titleKey = post.title.normalize('NFKC').replace(/[\s|丨｜]/g, '').toLowerCase();
  const key = unique.has(post.bvid) ? post.bvid : titleKeys.get(titleKey) || post.bvid;
  const existing = unique.get(key);
  if (existing) existing.sources = [...new Map([...existing.sources, ...post.sources].map(source => [source.mid, source])).values()];
  else { unique.set(key, post); titleKeys.set(titleKey, key); }
}
const classified = [...unique.values()].flatMap(post => {
  const titleMapping = classifyOfficialVideo(post.title, characters);
  const verified = tagEvidence.get(post.bvid);
  const tagNames = verified?.title === post.title ? charactersFromOfficialTags(verified.tags, characters) : [];
  const mapping = titleMapping || (tagNames.length ? { category: '角色短片' as const, characterNames: tagNames } : null);
  return mapping && post.bvid ? [{ ...post, ...mapping, url: `https://www.bilibili.com/video/${post.bvid}/` }] : [];
});
const scannedCount = sources.reduce((count, source) => count + source.posts.length, 0);
const output = { schemaVersion: 1, checkedAt: sources.map(source => source.checkedAt).sort().at(-1), sourceUrl: sources[0].source, ownerMid: '1955897084', ownerName: '鸣潮', sources: sources.map(source => ({ url: source.source, mid: source.ownerMid || '1955897084', name: source.ownerName || '鸣潮', scannedCount: source.posts.length, checkedAt: source.checkedAt })), scannedCount, uniquePostCount: unique.size, videos: classified };
await mkdir('public/data', { recursive: true });
await writeFile('public/data/videos.json', JSON.stringify(output) + '\n');
console.log({ scanned: scannedCount, deduplicated: unique.size, selected: classified.length, coveredCharacters: new Set(classified.flatMap(v => v.characterNames)).size });
